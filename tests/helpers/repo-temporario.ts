// Repositório Git temporário para os testes do scanner de dado real (vazamento.py) e dos hooks.
// O conteúdo "sujo" dos casos é montado aqui, em tempo de teste: arquivos com CPF, telefone ou e-mail de
// aparência real dentro da árvore fariam o próprio scanner barrar o repositório.
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

export const RAIZ = path.resolve(__dirname, '..', '..')

export function temPython(): boolean {
  return spawnSync('python3', ['--version']).status === 0
}

/** CPF com dígitos verificadores corretos a partir de 9 dígitos-base (montado em tempo de teste). */
export function cpfValido(base: string): string {
  const nums = base.split('').map(Number)
  for (const tam of [9, 10]) {
    const soma = nums.slice(0, tam).reduce((acc, n, i) => acc + n * (tam + 1 - i), 0)
    const resto = (soma * 10) % 11
    nums.push(resto === 10 ? 0 : resto)
  }
  return nums.join('')
}

export type Saida = { status: number | null; stdout: string; stderr: string }

export class RepoTemporario {
  readonly dir: string

  constructor() {
    this.dir = mkdtempSync(path.join(tmpdir(), 'vazamento-'))
    this.git('init', '-q', '-b', 'main')
    this.git('config', 'user.email', 'teste@exemplo.com')
    this.git('config', 'user.name', 'Teste')
    this.git('config', 'commit.gpgsign', 'false')
  }

  /** Copia o scanner e a lista de exceções reais do projeto para dentro do repositório temporário. */
  instalarScanner(): void {
    mkdirSync(path.join(this.dir, 'scripts'), { recursive: true })
    for (const nome of ['vazamento.py', 'vazamento-excecoes.txt']) {
      copyFileSync(path.join(RAIZ, 'scripts', nome), path.join(this.dir, 'scripts', nome))
    }
  }

  escrever(relativo: string, conteudo: string | Buffer): void {
    const alvo = path.join(this.dir, relativo)
    mkdirSync(path.dirname(alvo), { recursive: true })
    writeFileSync(alvo, conteudo)
  }

  git(...args: string[]): SpawnSyncReturns<string> {
    return spawnSync('git', args, { cwd: this.dir, encoding: 'utf8' })
  }

  /** Roda o scanner. `PT_INFRA_TERMOS` e `PT_NOMES_PROIBIDOS` só entram se o caso pedir; o ambiente do dono não vaza para o teste. */
  rodar(args: string[] = [], env: Record<string, string> = {}, stdin?: string): Saida {
    const ambiente = { ...process.env, ...env }
    for (const v of ['PT_INFRA_TERMOS', 'PT_NOMES_PROIBIDOS']) if (!(v in env)) delete ambiente[v]
    const r = spawnSync('python3', ['scripts/vazamento.py', ...args], {
      cwd: this.dir,
      encoding: 'utf8',
      env: ambiente,
      input: stdin,
    })
    return { status: r.status, stdout: r.stdout, stderr: r.stderr }
  }

  limpar(): void {
    rmSync(this.dir, { recursive: true, force: true })
  }
}
