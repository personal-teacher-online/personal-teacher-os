// Hook PostToolUse em Edit/Write (Etapa 3 do fluxo paralelo, 11/10/2026).
//
// Depois de cada edição de arquivo de código, roda o eslint SÓ naquele arquivo
// (~4 s medidos). Erro → sai com código 2 e o relatório no stderr, que o
// Claude Code devolve à sessão como feedback; a sessão corrige antes de seguir.
// Aviso (warning) não bloqueia: a régua é a mesma do CI (`eslint .` só falha
// com erro). Arquivo que não é código, ou fora do repositório, é ignorado.
//
// Sem shell: chama o eslint pelo próprio node com args em array, então caminho
// com espaço não precisa de aspas e o Node 24 não avisa (DEP0190).
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import { lerEntrada } from './_entrada.mjs'

const entrada = await lerEntrada()
const cwd = entrada.cwd || process.cwd()
const bruto = entrada.tool_input?.file_path
if (!bruto) process.exit(0)

const arquivo = isAbsolute(bruto) ? bruto : resolve(cwd, bruto)
const rel = relative(cwd, arquivo)
const EXTENSOES = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const IGNORADOS = /^(node_modules|\.next|out|build|supabase[\\/]\.temp)([\\/]|$)/

if (
  rel.startsWith('..') || // fora do repositório desta sessão
  !EXTENSOES.has(extname(arquivo)) ||
  IGNORADOS.test(rel) ||
  !existsSync(arquivo) // apagado nesta mesma edição
) {
  process.exit(0)
}

const eslint = join(cwd, 'node_modules', 'eslint', 'bin', 'eslint.js')
if (!existsSync(eslint)) {
  // Sem dependências instaladas não há o que rodar; o hook de início da
  // sessão é quem instala. Não bloqueia a edição por isso.
  process.exit(0)
}

const r = spawnSync(
  process.execPath,
  [eslint, '--cache', '--cache-location', join('node_modules', '.cache', 'eslint'), '--format', 'stylish', arquivo],
  { cwd, encoding: 'utf8' },
)

if (r.status === 0) process.exit(0)

const saida = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim()
process.stderr.write(
  `[eslint] ${rel} tem erro de lint — corrija antes de seguir (a régua é a mesma do CI e do pre-commit):\n${saida}\n`,
)
process.exit(2)
