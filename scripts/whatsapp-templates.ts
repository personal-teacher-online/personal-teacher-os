// JSON DE SUBMISSÃO DOS TEMPLATES DE WHATSAPP À META (ADR-038 · issue #41).
//
// Imprime uma LISTA JSON com um elemento por template (`name`, `language`,
// `category`, `components` com o `BODY` e o `example` e, desde a #115, o
// `BUTTONS` com os botões de link, quando o template tem). Cada elemento é o corpo
// de UMA chamada `POST /{waba}/message_templates`: a Meta cria um template por
// chamada, e mandar a lista inteira de uma vez falha. A fonte é
// `src/lib/notify/whatsapp-templates.ts`; este script não tem texto.
// A cópia versionada em `docs/whatsapp-templates.json` tem de ser idêntica à
// saída (o teste `tests/whatsapp-templates.test.ts` compara byte a byte).
//
// Uso:
//   npm run -s whatsapp:templates                               (imprime)
//   npm run -s whatsapp:templates > docs/whatsapp-templates.json (regenera)
//   npm run -s whatsapp:templates -- --submeter                 (submete, #119)
//
// SUBMETER (passo AN.6 do runbook, pelo dono, de dentro do container de
// produção, onde estão WHATSAPP_CLOUD_TOKEN e WHATSAPP_WABA_ID): lê os nomes
// que já existem na conta (`GET /{waba}/message_templates?fields=name,status`,
// todas as páginas) e faz um POST por template AUSENTE, na ordem do catálogo.
// Nome que já existe é pulado em qualquer estado (#119: os dois aceitos em
// 01/11/2026 não se submetem de novo; um recusado com o mesmo nome a Meta não
// deixaria criar outra vez; ele aparece como "ATENÇÃO", porque corrigir é
// editar no painel da Meta). Um POST recusado, ou uma resposta que nem é JSON
// (página de erro da borda), não para os outros: o resumo no fim diz o que foi
// criado, o que foi pulado e o que voltou com erro (e o processo sai com
// código 1 se houve recusa ou existente recusado). O token nunca é impresso.

import { GRAPH_API_VERSION } from '@/lib/notify/cloud-api'
import {
  jsonDeSubmissao,
  payloadDeSubmissao,
  templatesParaSubmeter,
  type TemplateNaConta,
} from '@/lib/notify/whatsapp-templates'

const GRAPH = `https://graph.facebook.com/${GRAPH_API_VERSION}`

/** Estados de um template existente que não entregam: pular, mas avisar. */
const EXISTENTE_SEM_ENTREGA = ['REJECTED', 'PAUSED', 'DISABLED']

interface RespostaDaMeta {
  data?: TemplateNaConta[]
  paging?: { next?: string }
  id?: string
  status?: string
  error?: { message?: string; error_subcode?: number }
}

/** O corpo da resposta como JSON; uma página de erro que não é JSON vira só a mensagem. */
async function lerResposta(resposta: Response): Promise<RespostaDaMeta> {
  const texto = await resposta.text()
  try {
    return JSON.parse(texto) as RespostaDaMeta
  } catch {
    return { error: { message: `resposta sem JSON: ${texto.slice(0, 200)}` } }
  }
}

/** Os templates da conta, todas as páginas (a Meta pagina por `paging.next`). */
async function templatesDaConta(waba: string, token: string): Promise<TemplateNaConta[]> {
  const todos: TemplateNaConta[] = []
  let url: string | null =
    `${GRAPH}/${encodeURIComponent(waba)}/message_templates?fields=name,status&limit=100`
  while (url) {
    const resposta: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    const corpo = await lerResposta(resposta)
    if (!resposta.ok || !Array.isArray(corpo.data)) {
      throw new Error(`a Meta recusou a leitura dos templates (HTTP ${resposta.status}): ${corpo.error?.message ?? ''}`)
    }
    todos.push(...(corpo.data ?? []))
    url = corpo.paging?.next ?? null
  }
  return todos
}

async function submeter(): Promise<void> {
  const token = process.env.WHATSAPP_CLOUD_TOKEN
  const waba = process.env.WHATSAPP_WABA_ID
  if (!token || !waba) {
    throw new Error('faltam WHATSAPP_CLOUD_TOKEN e WHATSAPP_WABA_ID no ambiente (rode de dentro do container de produção)')
  }
  const { submeter: novos, pular } = templatesParaSubmeter(payloadDeSubmissao(), await templatesDaConta(waba, token))
  const semEntrega = pular.filter((t) => EXISTENTE_SEM_ENTREGA.includes(t.status))
  for (const t of pular) {
    const atencao = EXISTENTE_SEM_ENTREGA.includes(t.status) ? 'ATENÇÃO, corrigir editando no painel da Meta — ' : ''
    console.log(`${atencao}pulado (já existe na conta, ${t.status}): ${t.name}`)
  }

  const recusados: string[] = []
  for (const t of novos) {
    const resposta = await fetch(`${GRAPH}/${encodeURIComponent(waba)}/message_templates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(t),
    })
    const corpo = await lerResposta(resposta)
    if (resposta.ok && corpo.id) {
      console.log(`criado: ${t.name} (id ${corpo.id ?? '?'}, ${corpo.status ?? '?'})`)
    } else {
      recusados.push(t.name)
      console.log(
        `RECUSADO: ${t.name} (HTTP ${resposta.status}, subcódigo ${corpo.error?.error_subcode ?? '?'}): ${corpo.error?.message ?? ''}`,
      )
    }
  }
  console.log(
    `\nresumo: ${novos.length - recusados.length} criado(s), ${pular.length} pulado(s) ` +
      `(${semEntrega.length} sem entrega), ${recusados.length} recusado(s)`,
  )
  if (recusados.length || semEntrega.length) process.exitCode = 1
}

if (process.argv.includes('--submeter')) {
  submeter().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  })
} else {
  process.stdout.write(jsonDeSubmissao())
}
