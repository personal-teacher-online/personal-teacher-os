// Leitura do JSON que o Claude Code manda aos hooks pelo stdin — compartilhada
// pelos hooks de `.claude/hooks/` (Etapa 3, 11/10/2026).
//
// Limite de tempo curto: stdin que não fecha não pode segurar o hook (e, no
// SessionStart, o início da sessão). Entrada vazia, inválida ou atrasada vira
// `{}` — cada hook decide o fallback (normalmente `process.cwd()`).

function lerStdin(limiteMs) {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('')
    let s = ''
    const fim = (v) => {
      clearTimeout(t)
      resolve(v)
    }
    const t = setTimeout(() => fim(s), limiteMs)
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => (s += c))
    process.stdin.on('end', () => fim(s))
    process.stdin.on('error', () => fim(''))
  })
}

/** O objeto do hook (session_id, cwd, hook_event_name, tool_input…) ou `{}`. */
export async function lerEntrada(limiteMs = 2000) {
  try {
    const bruto = await lerStdin(limiteMs)
    return bruto ? JSON.parse(bruto) : {}
  } catch {
    return {}
  }
}
