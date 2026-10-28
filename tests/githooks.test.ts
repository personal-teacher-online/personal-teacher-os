// Hooks .githooks/pre-commit e pre-push (issue #51): o commit e o push com dado real são recusados.
// Cria repositórios temporários, liga os hooks reais do projeto e usa o scanner real (python3).
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RAIZ, RepoTemporario, temPython } from './helpers/repo-temporario'

const EMAIL_REAL = 'fulano' + '@' + 'gmail.com'

describe.skipIf(!temPython())('.githooks: varredura de dado real', () => {
  let repo: RepoTemporario
  let remoto: string

  beforeEach(() => {
    repo = new RepoTemporario()
    repo.instalarScanner()
    repo.git('config', 'core.hooksPath', path.join(RAIZ, '.githooks'))
    repo.git('add', 'scripts/vazamento.py', 'scripts/vazamento-excecoes.txt')
    // O script em si é limpo; o commit inicial já passa pelo pre-commit.
    expect(repo.git('commit', '-q', '-m', 'scanner').status).toBe(0)
    remoto = mkdtempSync(path.join(tmpdir(), 'vazamento-remoto-'))
    spawnSync('git', ['init', '-q', '--bare', '-b', 'main', remoto])
    repo.git('remote', 'add', 'origin', remoto)
  })

  afterEach(() => {
    repo.limpar()
    rmSync(remoto, { recursive: true, force: true })
  })

  it('pre-commit recusa commit com e-mail real e aceita o commit limpo', () => {
    repo.escrever('docs/sujo.md', `contato: ${EMAIL_REAL}\n`)
    repo.git('add', 'docs/sujo.md')
    const recusado = repo.git('commit', '-q', '-m', 'sujo')
    expect(recusado.status).not.toBe(0)
    expect(recusado.stdout + recusado.stderr).toContain('e-mail real')
    expect(repo.git('log', '--oneline').stdout.trim().split('\n')).toHaveLength(1)

    repo.git('rm', '-q', '--cached', 'docs/sujo.md')
    repo.escrever('docs/limpo.md', 'nada de dado real aqui\n')
    repo.git('add', 'docs/limpo.md')
    expect(repo.git('commit', '-q', '-m', 'limpo').status).toBe(0)
  })

  it('pre-push recusa o push de um commit antigo com e-mail real (que passou sem hook)', () => {
    repo.escrever('docs/sujo.md', `contato: ${EMAIL_REAL}\n`)
    repo.git('add', 'docs/sujo.md')
    // Cherry-pick, rebase e edição pela web não passam pelo pre-commit: simulado com --no-verify.
    expect(repo.git('commit', '-q', '--no-verify', '-m', 'sujo').status).toBe(0)
    repo.escrever('docs/depois.md', 'limpo\n')
    repo.git('add', 'docs/depois.md')
    expect(repo.git('commit', '-q', '-m', 'depois').status).toBe(0)

    const recusado = repo.git('push', 'origin', 'main')
    expect(recusado.status).not.toBe(0)
    expect(recusado.stdout + recusado.stderr).toContain('docs/sujo.md@')
    expect(spawnSync('git', ['rev-parse', '--verify', '-q', 'main'], { cwd: remoto }).status).not.toBe(0)
  })

  it('pre-push deixa passar um push limpo', () => {
    repo.escrever('docs/limpo.md', 'limpo\n')
    repo.git('add', 'docs/limpo.md')
    expect(repo.git('commit', '-q', '-m', 'limpo').status).toBe(0)
    const r = repo.git('push', 'origin', 'main')
    expect(r.status, r.stderr).toBe(0)
  })
})
