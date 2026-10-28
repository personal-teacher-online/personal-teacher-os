// Hook SessionStart (Etapa 2 do fluxo paralelo, 10/10/2026).
//
// Worktree nova nasce sem `node_modules` (é ignorado pelo git e o Claude Code
// não o copia). Este hook instala as dependências quando faltam OU quando o
// package-lock.json mudou depois da última instalação, e lembra a sessão da
// regra da bancada compartilhada. O que ele imprime vai para o contexto da
// sessão, então é curto.
//
// Lê o `cwd` do JSON que o Claude Code manda no stdin (segue a worktree;
// `CLAUDE_PROJECT_DIR` fica na raiz original quando a sessão entra numa
// worktree no meio do caminho). A leitura tem limite de 2 s: stdin que não
// fecha não pode segurar o início da sessão.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { lerEntrada } from './_entrada.mjs'

const entrada = await lerEntrada()
const cwd = entrada.cwd || process.cwd()
const linhas = []

/** O npm grava `node_modules/.package-lock.json` ao instalar; se o lockfile do
 *  projeto diverge dele, a instalação está velha (merge trouxe pacote novo) ou
 *  foi interrompida. */
function instalacaoAtual() {
  const lock = join(cwd, 'package-lock.json')
  const gravado = join(cwd, 'node_modules', '.package-lock.json')
  if (!existsSync(gravado)) return false
  try {
    const lockfile = JSON.parse(readFileSync(lock, 'utf8')).packages ?? {}
    const instalado = JSON.parse(readFileSync(gravado, 'utf8')).packages ?? {}
    // O lockfile lista também os pacotes OPCIONAIS de outras plataformas
    // (sharp-darwin-*, sharp-libvips-linux-* etc.), que o npm pula no Windows —
    // medido em 10/10/2026: 115 entradas, todas `optional: true`. Por isso a
    // regra é: todo pacote NÃO opcional do lockfile precisa estar instalado na
    // mesma versão, e nada instalado pode divergir do lockfile.
    for (const [k, v] of Object.entries(lockfile)) {
      if (k === '' || v.optional === true) continue
      if (instalado[k]?.version !== v.version) return false
    }
    for (const [k, v] of Object.entries(instalado)) {
      if (lockfile[k]?.version !== v.version) return false
    }
    return true
  } catch {
    return false
  }
}

if (!existsSync(join(cwd, 'package.json'))) {
  linhas.push(`[sessão] ${cwd} não tem package.json — hook de dependências pulado.`)
} else if (existsSync(join(cwd, 'node_modules')) && instalacaoAtual()) {
  linhas.push(`[sessão] dependências já instaladas e em dia em ${cwd}.`)
} else {
  const motivo = existsSync(join(cwd, 'node_modules')) ? 'node_modules desatualizado' : 'worktree sem node_modules'
  const log = join(tmpdir(), `npm-ci-${Date.now()}.log`)
  linhas.push(`[sessão] ${motivo} — rodando npm ci em ${cwd} (log: ${log})…`)
  const inicio = Date.now()
  // Comando como string única: no Windows o npm é npm.cmd e só roda via shell,
  // e o Node 24 avisa (DEP0190) quando recebe args separados com shell: true.
  const r = spawnSync('npm ci --no-audit --no-fund', {
    cwd,
    shell: true,
    encoding: 'utf8',
    env: { ...process.env, CI: '1' },
  })
  const seg = Math.round((Date.now() - inicio) / 1000)
  try {
    writeFileSync(log, `${r.stdout ?? ''}\n${r.stderr ?? ''}\n${r.error ? String(r.error) : ''}`)
  } catch {}
  if (r.status === 0) {
    linhas.push(`[sessão] npm ci concluído em ${seg}s.`)
  } else {
    const causa = r.error ? ` — ${r.error.message}` : ''
    linhas.push(
      `[sessão] npm ci FALHOU (status ${r.status}${causa}) em ${seg}s — veja ${log}. Rode npm ci à mão antes de continuar.`,
    )
  }
}

// Pre-commit do projeto (Etapa 3): o git não liga hooks versionados sozinho —
// `core.hooksPath` é configuração local do repositório. Aqui ela é gravada de
// forma idempotente; a config é compartilhada entre o checkout e as worktrees,
// e o caminho relativo resolve na raiz de cada uma.
if (existsSync(join(cwd, '.githooks', 'pre-commit'))) {
  const atual = spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd, encoding: 'utf8' })
  if ((atual.stdout ?? '').trim() !== '.githooks') {
    const r = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd, encoding: 'utf8' })
    linhas.push(
      r.status === 0
        ? '[sessão] pre-commit do projeto ligado (core.hooksPath=.githooks): tsc + eslint antes de cada commit.'
        : `[sessão] não consegui ligar o pre-commit (git config falhou: ${(r.stderr ?? '').trim()}).`,
    )
  }
}

// Lembrete que o CLAUDE.md também traz — aqui ele chega no primeiro turno.
linhas.push(
  '[sessão] A bancada local (Supabase em 54321/54322) é UMA só e compartilhada entre worktrees: ' +
    'antes de `supabase db reset` ou da suíte completa, confirme com o dono que nenhuma outra sessão está usando. ' +
    'A suíte oficial de cada PR é o CI do GitHub.',
)

console.log(linhas.join('\n'))
