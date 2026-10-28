import { DateTime } from 'luxon'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { CopyButton } from '@/components/CopyButton'
import {
  btnInkSm,
  input,
  inputSm,
  linkActionXs,
  linkDanger,
  ConfirmAction,
  Field,
  FlashMsg,
  Pill,
} from '@/components/ui'
import { extrairTermo, semEmoji } from '@/lib/content/compose'
import { parseRoteiroExibicao } from '@/lib/content/roteiro'
import { GerarAgoraBotao } from './gerar-agora'
import { RoteiroVisao } from './roteiro-visao'
import {
  approveIdeaAction,
  approvePostAction,
  discardAction,
  gerarAgoraAction,
  markPublishedAction,
  rejectPostAction,
  retryAction,
  swapImageVariantAction,
  unlockGeneratingAction,
  updateDraftAction,
} from '../posts/actions'

export const metadata = { title: 'Post — Admin' }

// Detalhe do post da fábrica (ADR-021). Edição SÓ em rascunho (o guard congela
// aprovado/publicado — Lei 8). Preview do carrossel compõe o TEXTO POR CIMA da
// imagem (Lei 11: o texto nunca está dentro da imagem gerada).

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

type Slide = { ordem: number; titulo?: string; texto: string; termo?: string; prompt_imagem?: string }
type Img = { slide: number | null; variante?: number; drive_file_id: string; provider: string }

export default async function ConteudoPostPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ msg?: string }>
}) {
  const { id } = await params
  const { msg } = await searchParams
  const supabase = await createClient()
  const { data: p } = await supabase
    .from('content_posts')
    .select(
      'id, kind, status, tema, gancho, idea, legenda, roteiro, slides, images, image_provider, generation_error, generation_attempts, generation_started_at, rejection_reason, scheduled_for, post_url, updated_at',
    )
    .eq('id', id)
    .maybeSingle()
  if (!p) notFound()

  const s = STATUS_PT[p.status] ?? { label: p.status, tone: 'neutral' as const }
  const slides = (p.slides ?? []) as Slide[]
  const images = (p.images ?? []) as Img[]
  // A cena que vale é a PRIMEIRA registrada para o slide; as demais são as
  // outras versões geradas, alcançáveis pelo botão de trocar.
  const ativaPorSlide = new Map<number | null, Img>()
  const quantasVersoes = new Map<number | null, number>()
  for (const im of images) {
    const chave = im.slide ?? null
    if (!ativaPorSlide.has(chave)) ativaPorSlide.set(chave, im)
    quantasVersoes.set(chave, (quantasVersoes.get(chave) ?? 0) + 1)
  }
  // Posts antigos gravaram a foto da capa sem número — o slide 1 herda.
  const cenaDo = (ordem: number) =>
    ativaPorSlide.get(ordem) ?? (ordem === 1 ? ativaPorSlide.get(null) : undefined)
  const versoesDo = (ordem: number) =>
    quantasVersoes.get(ordem) ?? (ordem === 1 ? (quantasVersoes.get(null) ?? 0) : 0)
  const capa = cenaDo(1) ?? images[0] ?? null
  const editable = p.status === 'rascunho'
  const idea = (p.idea ?? {}) as Record<string, unknown>

  // Visão de gravação (M3): só o reel tem roteiro. Em RASCUNHO com formato
  // irreconhecível a visão não aparece — ali a textarea logo abaixo já É o texto
  // cru, e dois blocos com o mesmo conteúdo seria ruído.
  const lidoParaVisao = p.kind === 'roteiro_reel' && p.roteiro ? parseRoteiroExibicao(p.roteiro) : null
  const mostraVisao = Boolean(lidoParaVisao) && !(editable && lidoParaVisao?.ok === false)
  // Degradar em silêncio esconderia um formato incompatível por meses.
  if (lidoParaVisao && !lidoParaVisao.ok) {
    console.warn(`[roteiro] post ${p.id}: texto não reconhecido (${lidoParaVisao.motivo})`)
  } else if (lidoParaVisao?.ok && lidoParaVisao.avisos.length > 0) {
    console.warn(`[roteiro] post ${p.id}: ${lidoParaVisao.avisos.length} linha(s) fora do formato`)
  }

  const proveniencia = [
    ['O que acontece no reel', idea.premissa],
    ['De onde veio', idea.de_onde_veio],
    ['Pergunta à Teacher Vicky', idea.pergunta_a_vicky],
  ].filter(([, v]) => typeof v === 'string' && v.trim()) as Array<[string, string]>

  return (
    <main className="flex flex-col gap-4">
      <FlashMsg msg={msg} />

      <header className="flex flex-col gap-2">
        <Link href="/admin/conteudo/posts" className="text-xs font-semibold text-brand-700 hover:underline">
          ← Roteiros
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display text-2xl font-bold text-ink-900">{p.tema}</h2>
          <Pill tone={s.tone}>{s.label}</Pill>
          <span className="text-sm text-ink-400">{KIND_PT[p.kind] ?? p.kind}</span>
          {p.scheduled_for && (
            <span className="text-sm text-ink-400">
              alvo: {DateTime.fromISO(p.scheduled_for).setLocale('pt-BR').toFormat('dd/LL')}
            </span>
          )}
        </div>
        {p.gancho && <p className="max-w-2xl text-sm text-ink-600">{p.gancho}</p>}
        {typeof idea.descricao === 'string' && idea.descricao && (
          <p className="max-w-2xl text-xs text-ink-400">{idea.descricao}</p>
        )}
      </header>

      {proveniencia.length > 0 && (
        <section className="flex flex-col gap-1.5 rounded-card border border-line-soft bg-paper-50 p-4">
          <span className="text-xs font-bold tracking-wide text-ink-400 uppercase">De onde veio</span>
          {proveniencia.map(([rotulo, valor]) => (
            <p key={rotulo} className="text-sm text-ink-900">
              <span className="font-semibold text-ink-600">{rotulo}: </span>
              {valor}
            </p>
          ))}
        </section>
      )}

      {p.rejection_reason && (p.status === 'rejeitado' || p.status === 'ideia_aprovada') && (
        <p className="rounded-card border border-danger-700/30 bg-danger-700/5 p-3 text-sm text-ink-900">
          <span className="font-semibold">Motivo da rejeição:</span> {p.rejection_reason}
        </p>
      )}
      {p.generation_error && p.status !== 'rascunho' && (
        <p className="rounded-card border border-warn-700/30 bg-warn-700/5 p-3 text-sm text-ink-900">
          <span className="font-semibold">Última geração falhou:</span> {p.generation_error}
        </p>
      )}
      {p.status === 'gerando' && (
        <p className="text-xs text-ink-400">
          Gerando desde{' '}
          {p.generation_started_at
            ? DateTime.fromISO(p.generation_started_at).setZone('America/Cuiaba').setLocale('pt-BR').toFormat("dd/LL 'às' HH:mm")
            : '—'}{' '}
          (tentativa {p.generation_attempts}). Se travar, destrave abaixo.
        </p>
      )}

      {/* preview do carrossel/imagens — texto composto POR CIMA (Lei 11) */}
      {(slides.length > 0 || capa) && (
        <section className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2">
          {slides.length === 0 && capa && (
            <figure className="relative aspect-4/5 w-56 shrink-0 snap-start overflow-hidden rounded-card border border-line-soft bg-ink-900">
              {/* eslint-disable-next-line @next/next/no-img-element -- host dinâmico (proxy do Drive) */}
              <img src={`/admin/conteudo/img/${capa.drive_file_id}`} alt="" className="absolute inset-0 h-full w-full object-cover" />
            </figure>
          )}
          {slides.map((sl, i) => {
            const im = cenaDo(sl.ordem)
            const versoes = versoesDo(sl.ordem)
            const capaDeck = i === 0
            const { partes, termo } = extrairTermo(sl.texto, sl.termo)
            return (
              <div key={sl.ordem} className="flex w-56 shrink-0 snap-start flex-col gap-1.5">
                <figure className="relative aspect-4/5 overflow-hidden rounded-card border border-line-soft bg-ink-900">
                  {im && (
                    /* eslint-disable-next-line @next/next/no-img-element -- host dinâmico (proxy do Drive) */
                    <img src={`/admin/conteudo/img/${im.drive_file_id}`} alt="" className="absolute inset-0 h-full w-full object-cover" />
                  )}
                  <figcaption className="absolute inset-0 flex flex-col justify-end gap-1.5 bg-linear-to-t from-ink-900/90 via-ink-900/30 to-transparent p-3">
                    {capaDeck ? (
                      <span className="self-start bg-brand-700 px-2 py-1 font-display text-sm font-bold text-white">
                        {semEmoji(sl.texto || p.gancho || p.tema)}
                      </span>
                    ) : (
                      <>
                        {sl.titulo && (
                          <span className="text-[10px] font-bold tracking-[0.14em] text-white/70 uppercase">
                            {sl.titulo}
                          </span>
                        )}
                        <span className="text-xs leading-snug text-white/95">
                          {partes.map((p, k) =>
                            p.hl ? (
                              <span key={k} className="rounded-xs bg-brand-700 px-1 text-white">
                                {p.text}
                              </span>
                            ) : (
                              <span key={k}>{p.text}</span>
                            ),
                          )}
                        </span>
                        {termo && (
                          <span className="self-start bg-brand-700 px-2 py-0.5 font-display text-sm font-bold text-white">
                            {termo}
                          </span>
                        )}
                      </>
                    )}
                  </figcaption>
                </figure>
                <div className="flex items-center justify-between gap-2 px-0.5">
                  <span className="text-[10px] text-ink-400">
                    {im ? `slide ${sl.ordem}` : `slide ${sl.ordem} — sem cena`}
                  </span>
                  {editable && versoes > 1 && (
                    <form action={swapImageVariantAction}>
                      <input type="hidden" name="post_id" value={p.id} />
                      <input type="hidden" name="slide" value={sl.ordem} />
                      <button type="submit" className={linkActionXs} title={`${versoes} versões geradas`}>
                        trocar cena
                      </button>
                    </form>
                  )}
                </div>
              </div>
            )
          })}
        </section>
      )}

      {mostraVisao && p.roteiro && <RoteiroVisao texto={p.roteiro} />}

      {/* conteúdo editável (só rascunho) */}
      {(p.legenda || p.roteiro || editable) && (
        <form action={updateDraftAction} className="flex flex-col gap-3">
          <input type="hidden" name="post_id" value={p.id} />
          <Field label="Legenda">
            <textarea
              name="legenda"
              defaultValue={p.legenda ?? ''}
              readOnly={!editable}
              rows={6}
              className={`${input} min-h-32 w-full text-sm leading-relaxed`}
            />
          </Field>
          {/* O texto cru é o EDITOR; fora de rascunho quem mostra o roteiro é a
              visão de gravação acima (M3), sem duplicar o mesmo conteúdo. */}
          {editable && (p.kind === 'roteiro_reel' || p.roteiro) && (
            <Field label="Roteiro (para gravar)" hint="Edite aqui; a visão acima acompanha depois de salvar.">
              <textarea
                name="roteiro"
                defaultValue={p.roteiro ?? ''}
                rows={10}
                className={`${input} min-h-48 w-full leading-relaxed`}
              />
            </Field>
          )}
          {editable &&
            slides.map((sl) => (
              <div key={sl.ordem} className="flex flex-col gap-2 rounded-card border border-line-soft bg-paper-50 p-3">
                <span className="text-xs font-bold tracking-wide text-ink-400 uppercase">Slide {sl.ordem}</span>
                <input
                  name={`slide_titulo_${sl.ordem}`}
                  defaultValue={sl.titulo ?? ''}
                  placeholder="Título do slide"
                  className={inputSm}
                />
                <textarea
                  name={`slide_texto_${sl.ordem}`}
                  defaultValue={sl.texto}
                  rows={2}
                  className={`${input} w-full text-sm`}
                />
              </div>
            ))}
          {editable && (
            <div className="flex flex-wrap items-center gap-4">
              <button type="submit" className="btn-paper !min-h-9 !px-3 !py-1.5 !text-xs">
                Salvar rascunho
              </button>
            </div>
          )}
        </form>
      )}

      {/* ações por estado — transições são do banco; aqui só a UX */}
      <div className="flex flex-wrap items-center gap-4 border-t border-line-soft pt-4">
        {p.status === 'ideia' && (
          <form action={approveIdeaAction}>
            <input type="hidden" name="post_id" value={p.id} />
            <button type="submit" className={btnInkSm} title="Entra na fila — os agentes geram o rascunho">
              Aprovar ideia
            </button>
          </form>
        )}
        {p.status === 'ideia_aprovada' &&
          (p.generation_attempts >= 3 ? (
            <p className="text-sm text-ink-600">
              <span className="font-semibold">Três tentativas gastas nesta rodada.</span> Rejeite
              com um motivo para recomeçar — o motivo entra no prompt e o contador zera.
            </p>
          ) : (
            <form action={gerarAgoraAction}>
              <input type="hidden" name="post_id" value={p.id} />
              <GerarAgoraBotao tentativas={p.generation_attempts} />
            </form>
          ))}
        {p.status === 'rascunho' && (
          <form action={approvePostAction}>
            <input type="hidden" name="post_id" value={p.id} />
            <button type="submit" className={btnInkSm} title="Congela o conteúdo — pronto para publicar">
              Aprovar post
            </button>
          </form>
        )}
        {p.status === 'gerando' && (
          <form action={unlockGeneratingAction}>
            <input type="hidden" name="post_id" value={p.id} />
            <button type="submit" className={btnInkSm}>
              Destravar (voltar à fila)
            </button>
          </form>
        )}
        {p.status === 'rejeitado' && (
          <form action={retryAction}>
            <input type="hidden" name="post_id" value={p.id} />
            <button type="submit" className={btnInkSm} title="Os agentes tentam de novo usando o motivo como feedback">
              Tentar de novo
            </button>
          </form>
        )}
        {p.status === 'aprovado' && (
          <>
            {p.kind !== 'roteiro_reel' && slides.length > 0 && (
              <a
                href={`/admin/conteudo/${p.id}/cartoes`}
                className={btnInkSm}
                title="Cada slide com a sua cena e o texto composto por cima, pronto para postar"
              >
                Baixar carrossel pronto (ZIP)
              </a>
            )}
            {p.legenda && <CopyButton text={p.legenda} label="Copiar legenda" />}
            {slides.map((sl) => {
              const im = cenaDo(sl.ordem)
              if (!im) return null
              return (
                <a
                  key={im.drive_file_id}
                  href={`/admin/conteudo/img/${im.drive_file_id}?download=1`}
                  className={linkActionXs}
                >
                  baixar cena {sl.ordem} ↓
                </a>
              )
            })}
            <form action={markPublishedAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="post_id" value={p.id} />
              <input
                name="post_url"
                placeholder="link do post (opcional)"
                className={inputSm}
              />
              <button type="submit" className={btnInkSm} title="Depois de postar no Instagram — congela de vez">
                Marcar como publicado
              </button>
            </form>
          </>
        )}
        {p.status === 'publicado' && p.post_url && (
          <a href={p.post_url} target="_blank" rel="noreferrer" className={linkActionXs}>
            abrir post publicado ↗
          </a>
        )}

        {(p.status === 'ideia' || p.status === 'rascunho') && (
          <form action={rejectPostAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="post_id" value={p.id} />
            <input
              name="motivo"
              required
              placeholder="motivo (vira feedback para os agentes)"
              className={inputSm}
            />
            <button type="submit" className={linkDanger}>
              rejeitar
            </button>
          </form>
        )}

        {['ideia', 'ideia_aprovada', 'gerando', 'rascunho', 'rejeitado', 'aprovado'].includes(p.status) && (
          <ConfirmAction
            label="descartar"
            warning="Tira este post do caminho de vez — ele fica só no histórico (nada é apagado)."
            confirmLabel="descartar post"
            action={discardAction}
            values={{ post_id: p.id }}
            align="left"
          />
        )}
      </div>
    </main>
  )
}
