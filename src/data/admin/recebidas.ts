import 'server-only'

// CAMADA DE DADOS DA ABA RECEBIDAS (issue #113, ADR-038 itens 3 e 4) — o que os
// alunos escreveram ao número de envio do WhatsApp. SÓ LEITURA: não grava, não
// marca, não apaga e não aciona nada (palavra de parada só destaca a linha).
//
// DE ONDE VEM: cada mensagem do aluno é uma linha de `webhook_inbox` com
// `source = 'meta'` e `event_id = '<wamid>:message'`, gravada pela #44. Recibo
// (`<wamid>:sent|delivered|read|failed`) e `account_update` não terminam em
// `:message` e ficam de fora. A leitura é do servidor, com o cliente de serviço
// (como `sinalDe` em `ajustes.ts`): nenhuma policy nova.
//
// A JANELA É DE 90 DIAS, a mesma do expurgo (`purge_evolution_inbox`). O corte
// vai também na consulta, para a tela dizer a verdade mesmo se o job atrasar.
//
// COMO SE LÊ: o recorte (janela, período, aluno) vai no WHERE; as linhas do
// recorte são lidas de uma vez (90 dias de respostas de ~20 alunos cabem em
// uma ou duas páginas do PostgREST) porque o selo "Pediu para parar" e a
// contagem dele dependem do TEXTO, que o banco não pesquisa. Depois a lista
// pagina em memória (50 por página) e só a página atual busca o aluno e o aviso
// respondido.
//
// QUEM MANDOU: `from` (E.164 sem `+`) casa com `profiles.whatsapp_e164` (com
// `+`) comparando só dígitos; o aluno é o que tem esse perfil. Dois alunos podem
// dividir um número (família): a linha mostra os dois. Sem aluno, a tela mostra
// "Número desconhecido" (o caso do chip reciclado).

import type { SupabaseClient } from '@supabase/supabase-js'
import type { DateTime } from 'luxon'
import { z } from 'zod'

import { pedeParaParar } from '@/lib/notify/palavras-de-parada'

import { POR_PAGINA, contextoDaMensagem, instanteDaEscola, nomeDoTemplate, paginaValida } from './mensagens-gramatica'
import {
  DIAS_DAS_RECEBIDAS,
  chaveDoNumero,
  formasDoNumero,
  lerMensagemRecebida,
  numeroComMais,
  soDigitos,
  type MensagemRecebidaLida,
} from './recebidas-gramatica'

const LOTE_DO_POSTGREST = 1000

const LinhaDaInboxSchema = z.object({
  id: z.number(),
  payload: z.unknown(),
  received_at: z.string(),
})

export interface AlunoDaRecebida {
  id: string
  nome: string
}

export interface RecebidaDaLista {
  id: string
  /** "12/10 às 14:00" no fuso da escola */
  quando: string
  /** "+5565…" ou null quando a Meta não trouxe o remetente */
  numero: string | null
  /** vazio = "Número desconhecido" */
  alunos: AlunoDaRecebida[]
  /** "Texto", "Áudio", "Imagem"… */
  tipo: string
  /** o que ele escreveu; null para mídia */
  texto: string | null
  /** "Lembrete de aula · aula 14/10 às 09:00" quando a resposta casa com um aviso nosso */
  respondeA: string | null
  pediuParaParar: boolean
}

export interface RecebidasDaTela {
  linhas: RecebidaDaLista[]
  /** quantas mensagens o recorte tem (a contagem EXATA da aba) */
  total: number
  /** quantos NÚMEROS diferentes pedem para parar no recorte inteiro (não só na página; três PARAR do mesmo aluno contam 1) */
  paradas: number
  pagina: number
  totalDePaginas: number
  primeira: number
  ultima: number
}

/** O aluno do endereço não existe: a aba é vazia, nunca a escola inteira. */
export const RECEBIDAS_DE_ALUNO_INEXISTENTE: RecebidasDaTela = {
  linhas: [],
  total: 0,
  paradas: 0,
  pagina: 1,
  totalDePaginas: 1,
  primeira: 0,
  ultima: 0,
}

export interface RecorteDasRecebidas {
  /** instante ISO do corte; nunca antes da janela de 90 dias */
  desde: string
  /** números aceitos (dígitos) quando há aluno no filtro; null = todos; [] = ninguém */
  numeros: string[] | null
}

type Leitura<T> = { data: T; error: { message: string } | null }

function exigir<T>(leitura: string, r: Leitura<T>): T {
  if (r.error) throw new Error(`Mensagens recebidas: falha ao ler ${leitura}: ${r.error.message}`)
  return r.data
}

/** O início da janela de 90 dias. */
export function inicioDaJanelaDasRecebidas(agora: DateTime): string {
  return agora.minus({ days: DIAS_DAS_RECEBIDAS }).toISO()!
}

/**
 * Os números do aluno do filtro, em todas as grafias que a comparação aceita
 * (com e sem `+`; com e sem o 9 do celular antigo do Brasil). Aluno sem login ou
 * sem número: `[]` — a lista dele é vazia, nunca "todos".
 */
export async function numerosDoAluno(servico: SupabaseClient, profileId: string | null): Promise<string[]> {
  if (!profileId) return []
  const r = await servico.from('profiles').select('whatsapp_e164').eq('id', profileId).maybeSingle()
  const linha = z.object({ whatsapp_e164: z.string().nullable() }).nullable().parse(exigir('o número do aluno', r))
  const digitos = linha?.whatsapp_e164 ? soDigitos(linha.whatsapp_e164) : ''
  return digitos === '' ? [] : formasDoNumero(digitos).flatMap((f) => [f, `+${f}`])
}

/** As linhas de MENSAGEM da inbox da Meta, dentro do recorte. */
function daInbox(
  servico: SupabaseClient,
  recorte: RecorteDasRecebidas,
  colunas: string,
  opcoes?: { count: 'exact'; head: true },
) {
  let q = servico
    .from('webhook_inbox')
    .select(colunas, opcoes)
    .eq('source', 'meta')
    .like('event_id', '%:message')
    .gte('received_at', recorte.desde)
  if (recorte.numeros) q = q.in('payload->message->>from', recorte.numeros)
  return q
}

/** A contagem EXATA da aba, no mesmo formato das contagens do outbox. */
export async function contarRecebidas(
  servico: SupabaseClient,
  recorte: RecorteDasRecebidas,
): Promise<{ count: number | null; error: { message: string } | null }> {
  if (recorte.numeros?.length === 0) return { count: 0, error: null }
  const { count, error } = await daInbox(servico, recorte, 'id', { count: 'exact', head: true })
  return { count, error }
}

interface Lida {
  inboxId: number
  recebidaEm: string
  lida: MensagemRecebidaLida
  pediuParaParar: boolean
}

/** Todas as linhas do recorte, mais recentes primeiro (em lotes do PostgREST). */
async function lerTudo(servico: SupabaseClient, recorte: RecorteDasRecebidas): Promise<Lida[]> {
  const todas: Lida[] = []
  for (let de = 0; ; de += LOTE_DO_POSTGREST) {
    const r = await daInbox(servico, recorte, 'id, payload, received_at')
      .order('received_at', { ascending: false })
      .order('id', { ascending: false })
      .range(de, de + LOTE_DO_POSTGREST - 1)
    const lote = z.array(LinhaDaInboxSchema).parse(exigir('as mensagens recebidas', r))
    for (const l of lote) {
      const lida = lerMensagemRecebida(l.payload)
      todas.push({ inboxId: l.id, recebidaEm: l.received_at, lida, pediuParaParar: pedeParaParar(lida.texto) })
    }
    if (lote.length < LOTE_DO_POSTGREST) return todas
  }
}

/** Dígitos do número → alunos que o têm no perfil. */
async function alunosPorNumero(servico: SupabaseClient, digitos: string[]): Promise<Map<string, AlunoDaRecebida[]>> {
  const porNumero = new Map<string, AlunoDaRecebida[]>()
  if (digitos.length === 0) return porNumero
  const perfisR = await servico
    .from('profiles')
    .select('id, whatsapp_e164')
    .in('whatsapp_e164', digitos.flatMap(formasDoNumero).map(numeroComMais))
  const perfis = z
    .array(z.object({ id: z.string(), whatsapp_e164: z.string().nullable() }))
    .parse(exigir('os perfis dos números', perfisR))
  if (perfis.length === 0) return porNumero
  const alunosR = await servico
    .from('students')
    .select('id, display_name, profile_id')
    .in('profile_id', perfis.map((p) => p.id))
    .is('anonymized_at', null)
    .order('display_name')
  const alunos = z
    .array(z.object({ id: z.string(), display_name: z.string().nullable(), profile_id: z.string().nullable() }))
    .parse(exigir('os alunos dos números', alunosR))
  for (const a of alunos) {
    const perfil = perfis.find((p) => p.id === a.profile_id)
    const numero = perfil?.whatsapp_e164 ? chaveDoNumero(soDigitos(perfil.whatsapp_e164)) : null
    if (!numero) continue
    porNumero.set(numero, [...(porNumero.get(numero) ?? []), { id: a.id, nome: a.display_name ?? 'Aluno sem nome' }])
  }
  return porNumero
}

/** O aviso nosso a que o aluno respondeu: o rótulo da tela e a quem ele foi mandado. */
interface AvisoRespondido {
  /** "Lembrete de aula · aula 14/10 às 09:00" */
  rotulo: string
  /** o perfil que recebeu o aviso; null = aviso sem destinatário */
  perfilId: string | null
}

/** Id da mensagem nossa → o aviso respondido. */
async function avisosRespondidos(servico: SupabaseClient, wamids: string[]): Promise<Map<string, AvisoRespondido>> {
  const porWamid = new Map<string, AvisoRespondido>()
  if (wamids.length === 0) return porWamid
  const r = await servico
    .from('notification_outbox')
    .select('provider_message_id, template, payload, recipient_profile_id')
    .eq('provider', 'meta')
    .in('provider_message_id', wamids)
  const linhas = z
    .array(
      z.object({
        provider_message_id: z.string(),
        template: z.string(),
        payload: z.record(z.string(), z.unknown()).nullable(),
        recipient_profile_id: z.string().nullable(),
      }),
    )
    .parse(exigir('os avisos respondidos', r))
  for (const l of linhas) {
    const tipo = nomeDoTemplate(l.template)
    const contexto = contextoDaMensagem(l.payload)
    porWamid.set(l.provider_message_id, {
      rotulo: contexto ? `${tipo} · ${contexto}` : tipo,
      perfilId: l.recipient_profile_id,
    })
  }
  return porWamid
}

/** Perfil → alunos dele (fichas não anonimizadas). */
async function alunosPorPerfil(servico: SupabaseClient, perfis: string[]): Promise<Map<string, AlunoDaRecebida[]>> {
  const porPerfil = new Map<string, AlunoDaRecebida[]>()
  if (perfis.length === 0) return porPerfil
  const r = await servico
    .from('students')
    .select('id, display_name, profile_id')
    .in('profile_id', perfis)
    .is('anonymized_at', null)
    .order('display_name')
  const alunos = z
    .array(z.object({ id: z.string(), display_name: z.string().nullable(), profile_id: z.string().nullable() }))
    .parse(exigir('os alunos dos avisos respondidos', r))
  for (const a of alunos) {
    if (!a.profile_id) continue
    porPerfil.set(a.profile_id, [
      ...(porPerfil.get(a.profile_id) ?? []),
      { id: a.id, nome: a.display_name ?? 'Aluno sem nome' },
    ])
  }
  return porPerfil
}

/** A aba: a página pedida do recorte, com aluno e aviso respondido, e a contagem das paradas. */
export async function lerRecebidas(
  servico: SupabaseClient,
  recorte: RecorteDasRecebidas,
  paginaPedida: number,
): Promise<RecebidasDaTela> {
  const todas = recorte.numeros?.length === 0 ? [] : await lerTudo(servico, recorte)
  const { pagina, totalDePaginas } = paginaValida(paginaPedida, todas.length)
  const inicio = (pagina - 1) * POR_PAGINA
  const daPagina = todas.slice(inicio, inicio + POR_PAGINA)

  const [alunos, avisos] = await Promise.all([
    alunosPorNumero(servico, [...new Set(daPagina.map((l) => l.lida.numero).filter((n): n is string => n !== null))]),
    avisosRespondidos(servico, [
      ...new Set(daPagina.map((l) => l.lida.respondeAoWamid).filter((w): w is string => w !== null)),
    ]),
  ])
  // DONO DA LINHA: quando a resposta é a um aviso nosso, vale a quem o aviso foi
  // mandado, não o número de hoje. Sem isso, a dona que tira o WhatsApp da ficha
  // (o que a aba manda fazer) veria a mesma linha virar "Número desconhecido",
  // e um número que passou de um aluno para outro trocaria o dono do passado.
  // Sem contexto (mensagem solta), o único elo é o número.
  const donosDosAvisos = await alunosPorPerfil(servico, [
    ...new Set([...avisos.values()].map((a) => a.perfilId).filter((x): x is string => x !== null)),
  ])
  const donoDaLinha = (l: Lida): AlunoDaRecebida[] => {
    const perfil = l.lida.respondeAoWamid ? avisos.get(l.lida.respondeAoWamid)?.perfilId : null
    const doAviso = perfil ? donosDosAvisos.get(perfil) : undefined
    if (doAviso && doAviso.length > 0) return doAviso
    return (l.lida.numero && alunos.get(chaveDoNumero(l.lida.numero))) || []
  }

  const linhas: RecebidaDaLista[] = daPagina.map((l) => ({
    id: String(l.inboxId),
    quando: instanteDaEscola(l.recebidaEm) ?? '—',
    numero: l.lida.numero ? numeroComMais(l.lida.numero) : null,
    alunos: donoDaLinha(l),
    tipo: l.lida.tipo,
    texto: l.lida.texto,
    respondeA: (l.lida.respondeAoWamid && avisos.get(l.lida.respondeAoWamid)?.rotulo) || null,
    pediuParaParar: l.pediuParaParar,
  }))

  return {
    linhas,
    total: todas.length,
    paradas: new Set(
      todas
        .filter((l) => l.pediuParaParar)
        // PESSOAS, não mensagens: o mesmo número (em qualquer grafia) conta uma vez
        .map((l) => (l.lida.numero ? chaveDoNumero(l.lida.numero) : `sem-remetente:${l.inboxId}`)),
    ).size,
    pagina,
    totalDePaginas,
    primeira: linhas.length ? inicio + 1 : 0,
    ultima: inicio + linhas.length,
  }
}
