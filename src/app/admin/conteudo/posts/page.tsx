import { DateTime } from 'luxon'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import {
  inicioDaRodada,
  REGRA_POR_RODADA,
  resumoPorRodadas,
  type PostDaCoorte,
  type TrendDaRodada,
} from '@/lib/content/metricas'
import { getActiveBrandVoice } from '@/lib/content/voice'
import {
  btnInkSm,
  chipOn,
  chipOff,
  input,
  linkAction,
  toolbarLink,
  EmptyState,
  Field,
  FlashMsg,
  Pill,
  SectionTitle,
  SidePanel,
} from '@/components/ui'
import { createIdeaAction, publishBrandVoiceAction } from './actions'
import { MetricasPainel } from './metricas-painel'

export const metadata = { title: 'Conteúdo — Admin' }

// Fábrica de conteúdo (ADR-021): os agentes criam ideias e rascunhos; TUDO
// passa pelos dois portões da Teacher Vicky antes de qualquer post sair. Molde:
// /admin/relatorios (lista) + chips por situação de /admin/avisos.

const KIND_PT: Record<string, string> = {
  carrossel: 'Carrossel',
  story: 'Story',
  roteiro_reel: 'Roteiro de reel',
}

const STATUS_PT: Record<string, { label: string; tone: 'ok' | 'warn' | 'danger' | 'brand' | 'neutral' | 'muted' }> = {
  ideia: { label: 'ideia — aprove', tone: 'warn' },
  ideia_aprovada: { label: 'na fila', tone: 'neutral' },
  gerando: { label: 'gerando…', tone: 'brand' },
  rascunho: { label: 'rascunho — revise', tone: 'warn' },
  aprovado: { label: 'aprovado', tone: 'ok' },
  publicado: { label: 'publicado', tone: 'muted' },
  rejeitado: { label: 'rejeitado', tone: 'danger' },
  descartado: { label: 'descartado', tone: 'muted' },
  ciclo_futuro: { label: 'ciclo futuro', tone: 'muted' },
  arquivado: { label: 'arquivado', tone: 'muted' },
}

const TABS: Array<{ key: string; label: string; statuses: string[] }> = [
  { key: 'pendentes', label: 'Para você', statuses: ['ideia', 'rascunho'] },
  { key: 'fila', label: 'Na esteira', statuses: ['ideia_aprovada', 'gerando'] },
  { key: 'prontos', label: 'Prontos', statuses: ['aprovado'] },
  { key: 'publicados', label: 'Publicados', statuses: ['publicado'] },
  { key: 'todos', label: 'Todos', statuses: [] },
]

// Ordem dos blocos por formato (queixa do dono: não jogar tudo numa lista só).
// Formatos fora desta lista caem ao final; bloco vazio não aparece.
const FORMAT_ORDER = ['roteiro_reel', 'carrossel', 'story']

type Row = {
  id: string
  kind: string
  status: string
  tema: string
  gancho: string | null
  trend_id: string | null
  generation_error: string | null
  updated_at: string
}

/** Roteiro que nasceu de uma TREND do radar, não da mão da Teacher Vicky (Leva 6.1). A
 *  marca é a FK — a mesma chave que a coorte das métricas usa desde o cutover;
 *  o prefixo `pauta:` do Portão 1 morreu com ele. */
function daPauta(p: Row): boolean {
  return p.trend_id !== null
}

// Tabela (desktop): a coluna "Formato" some — o cabeçalho do bloco já o diz.
function PostsTable({ itens }: { itens: Row[] }) {
  return (
    <div className="hidden overflow-x-auto rounded-card border border-line-soft bg-paper-0 shadow-(--shadow-card) md:block">
      <table className="w-full text-sm">
        <thead className="border-b border-line text-left">
          <tr>
            <th className="px-4 py-2.5 text-xs font-bold tracking-wide text-ink-400 uppercase">Tema</th>
            <th className="px-4 py-2.5 text-xs font-bold tracking-wide text-ink-400 uppercase">Situação</th>
            <th className="px-4 py-2.5 text-xs font-bold tracking-wide text-ink-400 uppercase">Atualizado</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line-soft">
          {itens.map((p) => {
            const s = STATUS_PT[p.status] ?? { label: p.status, tone: 'neutral' as const }
            return (
              <tr key={p.id}>
                <td className="max-w-md px-4 py-2">
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 truncate font-semibold text-ink-900">{p.tema}</span>
                    {daPauta(p) && <Pill tone="muted">pauta</Pill>}
                  </span>
                  {p.gancho && <span className="block truncate text-xs text-ink-400">{p.gancho}</span>}
                </td>
                <td className="px-4 py-2">
                  <Pill tone={s.tone} title={p.generation_error ?? undefined}>
                    {s.label}
                  </Pill>
                </td>
                <td className="px-4 py-2 text-xs whitespace-nowrap text-ink-400">
                  {DateTime.fromISO(p.updated_at).setZone('America/Cuiaba').setLocale('pt-BR').toFormat("dd/LL 'às' HH:mm")}
                </td>
                <td className="px-4 py-2 text-right">
                  <Link href={`/admin/conteudo/${p.id}`} className={linkAction}>
                    abrir →
                  </Link>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// Cartões (celular): o formato já vem no cabeçalho do bloco — a sublinha mostra o gancho.
function PostsCards({ itens }: { itens: Row[] }) {
  return (
    <ul className="flex flex-col gap-2 md:hidden">
      {itens.map((p) => {
        const s = STATUS_PT[p.status] ?? { label: p.status, tone: 'neutral' as const }
        return (
          <li key={p.id}>
            <Link
              href={`/admin/conteudo/${p.id}`}
              className="card-interactive flex flex-col gap-1.5 rounded-card border border-line-soft bg-paper-0 p-4"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="min-w-0 font-semibold text-ink-900">{p.tema}</span>
                <Pill tone={s.tone}>{s.label}</Pill>
              </span>
              {(p.gancho || daPauta(p)) && (
                <span className="flex flex-wrap items-center gap-2 text-xs text-ink-400">
                  {daPauta(p) && <Pill tone="muted">pauta</Pill>}
                  {p.gancho}
                </span>
              )}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

export default async function ConteudoPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; st?: string; painel?: string }>
}) {
  const { msg, st, painel } = await searchParams
  const tab = TABS.some((t) => t.key === st) ? (st as string) : 'pendentes'
  const supabase = await createClient()
  // O banner fala do LOTE, nunca do estoque (ADR-036 / Leva 0.3): ideias
  // contam só na RODADA corrente (semana ISO — a janela da varredura) e por
  // COUNT exato do banco; a lista limitada abaixo é só a tabela, jamais o
  // contador (o limit(120) truncava a contagem em silêncio). Rascunho é
  // pendência REAL do portão 2 (teto de 2/dia impede pilha) e conta inteiro.
  const [{ data: posts }, voice, ideiasDaRodada, rascunhosPendentes] = await Promise.all([
    supabase
      .from('content_posts')
      .select('id, kind, status, tema, gancho, trend_id, scheduled_for, generation_error, updated_at')
      .neq('status', 'descartado')
      .order('updated_at', { ascending: false })
      .limit(120),
    getActiveBrandVoice(supabase),
    supabase
      .from('content_posts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'ideia')
      .gte('created_at', inicioDaRodada())
      .then((r) => r.count ?? 0),
    supabase
      .from('content_posts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'rascunho')
      .then((r) => r.count ?? 0),
  ])

  // Consultas SEPARADAS, e só quando o painel abre: a coorte precisa de
  // `roteiro` + `generation_meta` (kilobytes por linha) e inclui `descartado`,
  // que a lista esconde de propósito — descartar um roteiro É uma decisão, e
  // some da taxa se ficar de fora. Carregar isso em toda visita seria peso por
  // nada.
  //
  // São DUAS leituras porque são dois objetos (Leva 6.1): os ROTEIROS nascidos
  // de trend — com a semana da trend embarcada, porque é ela que dá a rodada —
  // e as TRENDS da varredura, que dão a conversão radar→roteiro. O teto é dito
  // em voz alta: acima dele a conta seria silenciosamente parcial, e o painel
  // inteiro existe para não mentir número.
  const TETO_DA_COORTE = 1000
  const TETO_DAS_TRENDS = 2000
  let resumo: ReturnType<typeof resumoPorRodadas> | null = null
  let estouro: string | null = null
  if (painel === 'metricas') {
    const [coorte, trends] = await Promise.all([
      supabase
        .from('content_posts')
        .select(
          'status, idea_approved_at, approved_at, roteiro, generation_meta, created_at, rejection_reason, trend:content_trends(semana)',
        )
        .not('trend_id', 'is', null)
        .limit(TETO_DA_COORTE)
        .then((r) => (r.data ?? []) as unknown as PostDaCoorte[]),
      supabase
        .from('content_trends')
        .select('semana, status, variacao_de')
        .limit(TETO_DAS_TRENDS)
        .then((r) => (r.data ?? []) as TrendDaRodada[]),
    ])
    resumo = resumoPorRodadas(coorte, trends, REGRA_POR_RODADA)
    if (coorte.length >= TETO_DA_COORTE || trends.length >= TETO_DAS_TRENDS) {
      estouro =
        'A leitura bateu no teto desta tela — os números abaixo são PARCIAIS. Fale com o mantenedor antes de decidir por eles.'
    }
  }
  const todas = posts ?? []
  const statuses = TABS.find((t) => t.key === tab)?.statuses ?? []
  const rows = statuses.length === 0 ? todas : todas.filter((p) => statuses.includes(p.status))
  // Blocos por formato dentro da aba ativa: ordem fixa + formatos extras ao fim; vazios fora.
  const kindsPresentes = [
    ...FORMAT_ORDER,
    ...Array.from(new Set(rows.map((p) => p.kind))).filter((k) => !FORMAT_ORDER.includes(k)),
  ]
  const grupos = kindsPresentes
    .map((kind) => ({ kind, itens: rows.filter((p) => p.kind === kind) }))
    .filter((g) => g.itens.length > 0)

  return (
    <main className="flex flex-col gap-4">
      <FlashMsg msg={msg} />

      <header>
        <h2 className="font-display text-2xl font-bold text-ink-900">
          Conteúdo <span className="font-sans text-base font-normal text-ink-400">fábrica de posts</span>
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-600">
          Os agentes trazem ideias e montam rascunhos com a sua voz — nada é publicado sem a sua
          aprovação, em dois momentos: a ideia e o post pronto.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {/* Decisão 3 do radar (ADR-035): "+ Nova ideia" vira ROTEIRO AVULSO —
            entrada manual sem trend, fora das métricas da pauta. O `?painel=nova`
            fica: é geometria interna, e renomeá-lo quebraria link colado à toa. */}
        <Link href="/admin/conteudo/posts?painel=nova" className={toolbarLink}>
          ＋ Roteiro avulso
        </Link>
        <Link href="/admin/conteudo/posts?painel=voz" className={toolbarLink}>
          🗣 Voz da marca {voice ? `(v${voice.version})` : '(publicar a primeira)'}
        </Link>
        {/* Rota IRMÃ, não painel: o cadastro de quem a pesquisa acompanha (M4),
            enquanto esta tela é a fila de posts. Label "Criadores" desde a
            Leva 1 (goal 1.3); o nome da PÁGINA fica para a Leva 7 com a Teacher Vicky. */}
        <Link href="/admin/conteudo/pauta" className={toolbarLink}>
          🎯 Criadores
        </Link>
        {/* 🚦 CUTOVER (Leva 5): o radar deixou de ser rota irmã e virou a CASA
            da seção — daqui o caminho é de VOLTA. Esta tela é o que sobra
            depois da decisão: a fila de roteiros prontos e o Portão 2. */}
        <Link href="/admin/conteudo" className={toolbarLink}>
          ← Radar
        </Link>
        <Link href="/admin/conteudo/posts?painel=metricas" className={toolbarLink}>
          📈 Como a pauta anda
        </Link>
      </div>

      {(ideiasDaRodada > 0 || rascunhosPendentes > 0) && (
        <p className="rounded-card border border-warn-700/30 bg-warn-700/5 p-3 text-sm text-ink-900">
          {ideiasDaRodada > 0 && (
            <>
              {ideiasDaRodada} ideia{ideiasDaRodada > 1 ? 's' : ''} nova
              {ideiasDaRodada > 1 ? 's' : ''} nesta rodada esperando o seu OK
              {rascunhosPendentes > 0 ? ' · ' : '. '}
            </>
          )}
          {rascunhosPendentes > 0 && (
            <>
              {rascunhosPendentes} rascunho{rascunhosPendentes > 1 ? 's' : ''} para revisar.{' '}
            </>
          )}
          <Link href="/admin/conteudo/posts?st=pendentes" className="font-semibold text-warn-700 hover:underline">
            Ver →
          </Link>
        </p>
      )}

      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <Link key={t.key} href={`/admin/conteudo/posts?st=${t.key}`} className={tab === t.key ? chipOn : chipOff}>
            {t.label}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Nada por aqui."
          hint="As ideias chegam pela esteira de pesquisa — ou crie um roteiro avulso agora."
        />
      ) : (
        <div className="flex flex-col gap-6">
          {grupos.map((g) => (
            <section key={g.kind} className="flex flex-col gap-2">
              <SectionTitle action={<span className="text-xs text-ink-400">{g.itens.length}</span>}>
                {KIND_PT[g.kind] ?? g.kind}
              </SectionTitle>
              <PostsTable itens={g.itens} />
              <PostsCards itens={g.itens} />
            </section>
          ))}
        </div>
      )}

      {painel === 'nova' && (
        <SidePanel title="Roteiro avulso" closeHref="/admin/conteudo/posts">
          <form action={createIdeaAction} className="flex flex-col gap-4">
            {/* O recorte já é verdade no DADO (a action insere sem trend_id e
                sem external_ref de pauta) — esta linha só o diz em voz alta. */}
            <p className="text-sm text-ink-600">
              Entrada manual, sem trend de origem — fica fora das métricas da pauta.
            </p>
            <Field label="Formato">
              <select name="kind" required className={input}>
                <option value="carrossel">Carrossel</option>
                <option value="story">Story</option>
                <option value="roteiro_reel">Roteiro de reel</option>
              </select>
            </Field>
            <Field label="Tema" hint="Ex.: phrasal verbs de viagem, erros com make/do…">
              <input name="tema" required className={input} />
            </Field>
            <Field label="Gancho (opcional)" hint="A primeira frase que segura a atenção.">
              <input name="gancho" className={input} />
            </Field>
            <button type="submit" className={btnInkSm}>
              Criar roteiro avulso
            </button>
          </form>
        </SidePanel>
      )}

      {painel === 'metricas' && resumo && (
        <SidePanel title="Como a pauta anda" closeHref="/admin/conteudo/posts">
          {estouro && (
            <p className="mb-4 rounded-card border border-warn-700/30 bg-warn-700/5 p-3 text-sm text-ink-900">
              {estouro}
            </p>
          )}
          <MetricasPainel resumo={resumo} regra={REGRA_POR_RODADA} />
        </SidePanel>
      )}

      {painel === 'voz' && (
        <SidePanel title="Voz da marca" closeHref="/admin/conteudo/posts">
          <div className="flex flex-col gap-4">
            {voice ? (
              <p className="text-xs text-ink-400">
                Versão {voice.version} ativa desde{' '}
                {DateTime.fromISO(voice.created_at).setZone('America/Cuiaba').setLocale('pt-BR').toFormat('dd/LL/yyyy')}
                . Publicar de novo cria a versão {voice.version + 1} (a antiga fica no histórico).
              </p>
            ) : (
              <p className="text-xs text-ink-400">
                Nenhuma voz publicada ainda — os agentes só geram conteúdo com ela no lugar.
              </p>
            )}
            <form action={publishBrandVoiceAction} className="flex flex-col gap-4">
              <Field label="Documento de voz (markdown)">
                <textarea
                  name="content_md"
                  defaultValue={voice?.content_md ?? ''}
                  rows={16}
                  className={`${input} min-h-72 w-full font-mono text-xs leading-relaxed`}
                />
              </Field>
              <Field label="Notas desta versão (opcional)">
                <input name="notes" className={input} />
              </Field>
              <button type="submit" className={btnInkSm}>
                Publicar nova versão
              </button>
            </form>
          </div>
        </SidePanel>
      )}
    </main>
  )
}
