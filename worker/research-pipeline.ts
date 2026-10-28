// WORKER DA PESQUISA DE PAUTA (M5 do ciclo 1 de conteúdo).
//
// Roda no terminal do mantenedor, uma vez por semana (molde `audit-pipeline.ts`;
// mesmo desvio da Lei 5 já registrado no ADR-015 — CLI em vez de fila viva).
// O app NUNCA chama isto: quem lê o resultado é a tela da Pauta e, no M6, o
// gerador de ideias.
//
// O que uma corrida faz, nesta ordem:
//   1. CRIADORES ativos → snapshot de métricas na ficha (grant de coluna do M4)
//      + os curtos mais vistos de cada um viram candidatos a análise.
//   2. TRENDS nas 5 redes → filtro por CÓDIGO (barato, antes de qualquer token)
//      → um registro por rede, com a janela SEMANAL no endereço.
//   3. ANÁLISE dos reels: dos criadores e do topo dos trends, só nas redes com
//      vídeo (YouTube, Instagram, TikTok — X e Reddit o banco recusa).
//   4. RADAR (Leva 2.2): cada análise ATIVA da rodada vira uma linha em
//      `content_trends` — velocidade, nota de viagem (Haiku, fail-open que se
//      cura) e dedup temática mirando `variacao_de`. Fonte que já é trend é
//      pulada ANTES de pagar modelo (re-corrida = 0 duplicata, custo ~zero).
//
// ── IDEMPOTÊNCIA QUE ECONOMIZA DINHEIRO ─────────────────────────────────────
// Antes de transcrever qualquer coisa, o worker pergunta ao banco quais
// endereços já têm run ativo. Sem `--force`, o que já existe NÃO é reanalisado:
// re-corrida na mesma semana custa quase zero. Com `--force`, a transcrição do
// run que vai ser superado é reaproveitada — refazer a análise não paga o
// Gemini de novo.
//
// ── O SUBCOMANDO `ideias` MORREU (Leva 6.2) ─────────────────────────────────
// Ele transformava a pesquisa em ideias no Portão 1 — que deixou de existir no
// cutover da Leva 5: escolher a trend no radar É a aprovação. Mantê-lo vivo
// significaria reabastecer, sem aviso, uma fila que nenhuma tela mostra mais.
// Quem fecha o laço agora é a etapa 5 abaixo (o digest do lote).
//
// Uso:  npm run worker:pesquisa -- [flags]
//   --force                  refaz a MESMA janela (cria run novo e supera o ativo)
//   --so=criadores|trends    roda só uma etapa
//   --so=estimativa          imprime a estimativa (cadastro real) e sai SEM gastar
//   --criador=<handle>       limita a um criador cadastrado
//   --rede=<rede>            limita os trends a uma rede (ator quebrado, retomada)
//   --sem-analise            coleta e registra trends, sem transcrever nada
//
// Envs: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, YOUTUBE_API_KEY,
//       APIFY_TOKEN, GEMINI_API_KEY, ANTHROPIC_API_KEY (OPENAI_API_KEY só para
//       o fallback de transcrição).

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import {
  BUSCAS,
  PASTA_MIDIA,
  REDES,
  REDE_ROTULO,
  REELS_ANALISADOS_POR_CRIADOR,
  REELS_ANALISADOS_POR_TREND,
  SUBREDDITS,
  temVideo,
  type Rede,
} from '../src/lib/research/config.ts'
import { type CorridaApify } from '../src/lib/research/apify.ts'
import { estimativaDaCorrida } from '../src/lib/research/estimativa.ts'
import { filtrar, fraseDoFiltro } from '../src/lib/research/filtro.ts'
import { analisarReel, transcrever, type Transcricao } from '../src/lib/research/analise.ts'
import { trendsDoInstagram, perfilDoInstagram } from '../src/lib/research/instagram.ts'
import { trendsDoReddit } from '../src/lib/research/reddit.ts'
import { trendsDoTiktok, perfilDoTiktok } from '../src/lib/research/tiktok.ts'
import { trendsDoX, perfilDoX } from '../src/lib/research/x.ts'
import {
  canalPorHandle,
  curtosDoCanal,
  trendsDoYoutube,
  type QuotaGasta,
} from '../src/lib/research/youtube.ts'
import { etapaRadar } from '../src/lib/research/radar.ts'
// O MESMO corte da aba PT que a tela usa — o digest diz "X em destaque" com a
// conta do radar, não com uma segunda régua (Leva 6.2).
import { LIMIAR_ABA_PT } from '../src/lib/content/limiar-pt.ts'
import {
  ativosPorFonte,
  carimbarMedicao,
  registrar,
  type AtivoDaFonte,
} from '../src/lib/research/registro.ts'
import {
  chaveDoReel,
  chaveDosTrends,
  engajamento,
  mediana,
  semanaIso,
  snapshotDoCriador,
  type ItemDaPesquisa,
} from '../src/lib/research/tipos.ts'

/* ========================================================================== */
/* Bandeiras e estado da corrida                                               */
/* ========================================================================== */

const FLAGS = process.argv.slice(2)
const flag = (nome: string) => FLAGS.includes(`--${nome}`)
const valor = (nome: string) =>
  FLAGS.find((f) => f.startsWith(`--${nome}=`))?.slice(nome.length + 3)

/** Subcomando = o primeiro argumento que NÃO começa com `--`. Sobrou UM worker
 *  (a varredura), mas o parser fica: chamada com subcomando velho na mão tem de
 *  falhar dizendo isso, não rodar a varredura inteira por engano. */
const SUBCOMANDO = FLAGS.find((f) => !f.startsWith('--')) ?? ''

const FORCE = flag('force')
const SEM_ANALISE = flag('sem-analise')
const SO = valor('so')
const SO_CRIADOR = valor('criador')
const SO_REDE = valor('rede')

const SEMANA = semanaIso()
const avisos: string[] = []
const falhas: string[] = []

const custo = {
  claudeUsd: 0,
  haikuUsd: 0,
  tokensGemini: 0,
  analises: 0,
  reaproveitadas: 0,
  puladas: 0,
}

function secao(titulo: string): void {
  console.log(`\n━━ ${titulo} ${'━'.repeat(Math.max(0, 60 - titulo.length))}`)
}

/** Uma fonte que falha não derruba as outras — a corrida termina com exitCode 1. */
async function tentar(rotulo: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (e) {
    const msg = (e as Error).message
    console.error(`  ✗ ${rotulo}: ${msg}`)
    falhas.push(`${rotulo}: ${msg}`)
    process.exitCode = 1
  }
}

/* ========================================================================== */
/* Etapa 1 — criadores                                                         */
/* ========================================================================== */

interface CriadorCadastrado {
  id: string
  plataforma: Rede
  handle: string
  nome: string
}

interface CandidatoAAnalise {
  item: ItemDaPesquisa
  creatorId: string | null
}

/** A leitura do cadastro sobe para ANTES da estimativa (Leva 1.1): é ela que
 *  diz quanto a corrida vai custar, então ela não pode vir depois do gasto. */
async function criadoresDoCadastro(admin: SupabaseClient): Promise<CriadorCadastrado[]> {
  let q = admin
    .from('content_creators')
    .select('id, plataforma, handle, nome')
    .eq('ativo', true)
    .order('nome')
  if (SO_CRIADOR) q = q.eq('handle', SO_CRIADOR)

  const { data, error } = await q
  if (error) throw new Error(`falha ao ler os criadores: ${error.message}`)
  return (data ?? []) as CriadorCadastrado[]
}

async function etapaCriadores(
  admin: SupabaseClient,
  quota: QuotaGasta,
  apify: CorridaApify,
  criadores: readonly CriadorCadastrado[],
): Promise<CandidatoAAnalise[]> {
  secao('CRIADORES (snapshot de métricas)')
  console.log(`${criadores.length} criadores ativos no cadastro`)

  const candidatos: CandidatoAAnalise[] = []

  for (const c of criadores) {
    await tentar(`${REDE_ROTULO[c.plataforma]} @${c.handle}`, async () => {
      let metricas: Record<string, number> = {}
      let curtos: ItemDaPesquisa[] = []

      if (c.plataforma === 'youtube') {
        const chave = exigeEnv('YOUTUBE_API_KEY')
        const canal = await canalPorHandle(c.handle, chave, quota)
        curtos = await curtosDoCanal(canal.playlistUploads, chave, quota, avisos)
        metricas = snapshotDoCriador({
          inscritos: canal.inscritos,
          'curtos recentes': curtos.length,
          'views medianas': mediana(curtos.map((v) => v.metricas.views ?? 0)),
        })
      } else if (c.plataforma === 'instagram') {
        const perfil = await perfilDoInstagram(c.handle, apify, avisos)
        metricas = perfil.metricas
        curtos = perfil.reels
      } else if (c.plataforma === 'tiktok') {
        const perfil = await perfilDoTiktok(c.handle, apify, avisos)
        metricas = perfil.metricas
        curtos = perfil.reels
      } else {
        // X não tem reel: só o snapshot (o banco recusaria `analise_reel` aqui).
        metricas = (await perfilDoX(c.handle, apify, avisos)).metricas
      }

      // `{}` COM carimbo é legítimo e quer dizer "mediu e não achou nada" — o
      // caso Vanessa do M2.0, que o CHECK `medicao_shape` deixa representável.
      await carimbarMedicao(admin, c.id, metricas)
      const resumo = Object.entries(metricas)
        .map(([k, v]) => `${k} ${v.toLocaleString('pt-BR')}`)
        .join(' · ')
      console.log(`  ✔ ${c.nome}: ${resumo || 'nada encontrado'}`)

      for (const item of curtos.slice(0, REELS_ANALISADOS_POR_CRIADOR)) {
        candidatos.push({ item, creatorId: c.id })
      }
    })
  }

  return candidatos
}

/* ========================================================================== */
/* Etapa 2 — trends                                                            */
/* ========================================================================== */

async function coletarTrends(
  rede: Rede,
  quota: QuotaGasta,
  apify: CorridaApify,
): Promise<ItemDaPesquisa[]> {
  switch (rede) {
    case 'youtube':
      return trendsDoYoutube(BUSCAS.youtube, exigeEnv('YOUTUBE_API_KEY'), quota, avisos)
    case 'reddit':
      return trendsDoReddit(SUBREDDITS, avisos)
    case 'instagram':
      return trendsDoInstagram(BUSCAS.instagram, apify, avisos)
    case 'tiktok':
      return trendsDoTiktok(BUSCAS.tiktok, apify, avisos)
    case 'x':
      return trendsDoX(BUSCAS.x, apify, avisos)
  }
}

async function etapaTrends(
  admin: SupabaseClient,
  quota: QuotaGasta,
  apify: CorridaApify,
  ativos: Map<string, AtivoDaFonte>,
): Promise<CandidatoAAnalise[]> {
  secao(`TRENDS (janela ${SEMANA})`)
  const candidatos: CandidatoAAnalise[] = []

  // `--rede=` existe por necessidade medida no primeiro dia: quando o ator de
  // UMA rede quebra (e quebrou — dois do X estavam mortos), refazer as cinco
  // para consertar uma é dinheiro jogado fora.
  for (const rede of REDES.filter((r) => !SO_REDE || r === SO_REDE)) {
    const chave = chaveDosTrends(rede, SEMANA)
    if (ativos.has(chave) && !FORCE) {
      console.log(`  · ${REDE_ROTULO[rede]}: já pesquisado nesta semana (run ${ativos.get(chave)!.run}) — pulando`)
      custo.puladas += 1
      continue
    }

    await tentar(`trends ${REDE_ROTULO[rede]}`, async () => {
      const brutos = await coletarTrends(rede, quota, apify)
      const r = filtrar(rede, brutos)
      console.log(`  ${fraseDoFiltro(rede, brutos.length, r)}`)

      const resposta = await registrar(admin, {
        tipo: 'trends',
        plataforma: rede,
        sourceKey: chave,
        force: FORCE,
        titulo: `Trends de ${REDE_ROTULO[rede]} — semana ${SEMANA}`,
        // O payload é DERIVADO/INFERIDO; os números medidos de cada item
        // andam junto dele porque descrevem o item, não a corrida.
        payload: {
          semana: SEMANA,
          busca: rede === 'reddit' ? SUBREDDITS : BUSCAS[rede],
          itens: r.itens,
          meta: { coletados: brutos.length, descartados: r.descartados },
        },
        // As MÉTRICAS da linha de trends são as contagens da própria corrida —
        // números medidos, não opinião.
        // As MÉTRICAS da linha de trends são as contagens da própria corrida —
        // números medidos, não opinião. `engajamento_do_topo` só entra onde
        // engajamento EXISTE: no Reddit a única coluna é a posição no top, e
        // gravá-la sob esse nome seria afirmar "engajamento 1" (a lição do A5:
        // a etiqueta tem de ser verdadeira sobre o número ao lado dela).
        metricas: {
          coletados: brutos.length,
          guardados: r.itens.length,
          ...(rede === 'reddit' || !r.itens[0]
            ? {}
            : { engajamento_do_topo: engajamento(r.itens[0]) }),
        },
      })
      console.log(`  ✔ ${REDE_ROTULO[rede]}: run ${resposta.run} (${resposta.foiCriado ? 'novo' : 'já existia'})`)

      if (temVideo(rede)) {
        for (const item of r.itens.slice(0, REELS_ANALISADOS_POR_TREND)) {
          candidatos.push({ item, creatorId: null })
        }
      }
    })
  }

  return candidatos
}

/* ========================================================================== */
/* Etapa 3 — análise dos reels                                                 */
/* ========================================================================== */

/** A transcrição do run que vai ser superado — refazer análise não paga Gemini. */
function transcricaoGuardada(ativo: AtivoDaFonte | undefined): Transcricao | null {
  const t = ativo?.payload?.transcricao as { texto?: string; via?: string } | undefined
  if (!t?.texto) return null
  return {
    texto: t.texto,
    via: (t.via as Transcricao['via']) ?? 'gemini-url',
    tokensGemini: 0,
  }
}

async function etapaAnalises(
  admin: SupabaseClient,
  candidatos: readonly CandidatoAAnalise[],
): Promise<void> {
  secao('ANÁLISE DE REELS')
  if (SEM_ANALISE) {
    console.log('  (--sem-analise: nada transcrito nesta corrida)')
    return
  }

  // Dedupe por endereço: o mesmo vídeo pode chegar pelo criador E pelo trend.
  const porChave = new Map<string, CandidatoAAnalise>()
  for (const c of candidatos) {
    if (!temVideo(c.item.rede)) continue
    // No YouTube o Gemini lê a URL pública; em IG/TikTok é preciso o arquivo.
    // Carrossel e imagem — metade do que a hashtag do Instagram devolve — não
    // têm o que transcrever, e mandá-los adiante gastaria uma volta para
    // descobrir isso.
    if (c.item.rede !== 'youtube' && !c.item.midiaUrl) continue
    const chave = chaveDoReel(c.item.rede, c.item.id)
    const jaTem = porChave.get(chave)
    // Vindo pelos dois caminhos, o do criador vence: ele carrega o `creator_id`.
    if (!jaTem || (!jaTem.creatorId && c.creatorId)) porChave.set(chave, c)
  }

  const ativos = await ativosPorFonte(admin, [...porChave.keys()])
  console.log(`${porChave.size} candidatos · ${ativos.size} já analisados`)

  let n = 0
  for (const [chave, { item, creatorId }] of porChave) {
    n += 1
    const ativo = ativos.get(chave)
    if (ativo && !FORCE) {
      custo.puladas += 1
      continue
    }

    await tentar(`análise ${chave}`, async () => {
      console.log(`\n  [${n}/${porChave.size}] ${REDE_ROTULO[item.rede]} · ${item.titulo.slice(0, 70)}`)

      let transcricao = FORCE ? transcricaoGuardada(ativo) : null
      if (transcricao) {
        custo.reaproveitadas += 1
        console.log('    transcrição reaproveitada do run anterior (Gemini não é pago de novo)')
      } else {
        transcricao = await transcrever(item)
        custo.tokensGemini += transcricao.tokensGemini
        console.log(`    transcrição: ${transcricao.texto.length} caracteres via ${transcricao.via}`)
      }

      const { analise, meta, custoUsd } = await analisarReel(admin, item, transcricao)
      custo.claudeUsd += custoUsd
      custo.analises += 1

      const resposta = await registrar(admin, {
        tipo: 'analise_reel',
        plataforma: item.rede,
        sourceKey: chave,
        force: FORCE,
        creatorId,
        titulo: item.titulo,
        url: item.url,
        publicadoEm: item.publicadoEm,
        payload: {
          analise,
          transcricao: { texto: transcricao.texto, via: transcricao.via },
          autor: item.autor,
          duracao_s: item.duracaoS,
          meta,
        },
        metricas: item.metricas,
      })
      console.log(`    ✔ run ${resposta.run} · gancho ${analise.gancho.tipo} · ${analise.beats.length} batidas`)
    })
  }
}

/* ========================================================================== */
/* Etapa 4 — radar (análises da rodada → content_trends, Leva 2.2)             */
/* ========================================================================== */

async function etapaRadarDoWorker(admin: SupabaseClient): Promise<void> {
  secao(`RADAR (análises da rodada → trends)`)
  await tentar('radar', async () => {
    const r = await etapaRadar(admin, { semana: SEMANA, log: (l) => console.log(`  ${l}`) })
    custo.haikuUsd += r.custoUsd

    console.log(
      `  ✔ ${r.criadas.length} trends novas · ${r.puladas} fontes já eram trends (puladas antes de gastar)`,
    )
    for (const s of r.criadas) console.log(`      ${s}`)
    // Dedup na era das trends: variação é LINHA própria; nada some em silêncio.
    if (r.variacoes.length) {
      console.log(`  ↳ ${r.variacoes.length} nasceram como VARIAÇÃO de tema que já existe:`)
      for (const v of r.variacoes) {
        console.log(`      ${v.sourceKey} → ${v.maeSourceKey} (sim ${v.similaridade})`)
      }
    }
    if (r.herdadas.length) {
      console.log(`  ✗ ${r.herdadas.length} nasceram DESCARTADAS — o tema já foi descartado pela dona (herança com marca e audit):`)
      for (const h of r.herdadas) {
        console.log(`      ${h.sourceKey} ~ ${h.maeSourceKey} (sim ${h.similaridade})`)
      }
    }
    if (r.semNota > 0) {
      console.log(`  ⚠ ${r.semNota} trends SEM nota de viagem nesta corrida (score NULL — a próxima corrida cura)`)
    }
    if (r.curadas > 0) {
      console.log(`  ✔ ${r.curadas} notas NULL de corridas anteriores preenchidas agora`)
    }
    if (r.falhas.length) {
      console.log(`  ⚠ ${r.falhas.length} ocorrências de fail-open no radar:`)
      for (const f of r.falhas) console.log(`      ${f}`)
    }
    for (const a of r.avisos) console.log(`  ⚠ AVISO: ${a}`)
  })
}

/* ========================================================================== */
/* Etapa 5 — o digest do lote (Leva 6.2, ADR-036 decisão 1)                    */
/* ========================================================================== */

/**
 * Fecha a corrida batendo na porta da dona: UM toque por admin por RODADA,
 * com os números do lote. Quem CONTA é o banco (a RPC), não este relatório: o
 * que ela vai abrir é a tela, e a tela lê a tabela — contar aqui daria um
 * número que só vale para esta corrida (a segunda da semana somaria errado).
 *
 * Dentro de `tentar`: falha de notificação não pode derrubar uma corrida que
 * já gastou API e já gravou trend. Fica na lista de falhas, com exitCode.
 */
async function digestDoLote(admin: SupabaseClient): Promise<void> {
  secao('DIGEST DO LOTE')

  // Achado 3 do Sol: corrida com RECORTE (`--so`, `--rede`, `--criador`) é
  // parcial por decisão de quem chamou — e o toque da rodada é UM. Se ele sair
  // com os números do recorte, a corrida cheia da mesma semana não conserta
  // nada depois que o despachante enviar. Recorte não avisa; a corrida cheia
  // avisa.
  const recorte = [SO && `--so=${SO}`, SO_REDE && `--rede=${SO_REDE}`, SO_CRIADOR && `--criador=${SO_CRIADOR}`]
    .filter(Boolean)
    .join(' ')
  if (recorte) {
    console.log(`  corrida com recorte (${recorte}) — ninguém é avisado.`)
    console.log('    o toque da rodada é UM: deixá-lo sair com número parcial queimaria a semana.')
    return
  }

  await tentar('digest', async () => {
    const { data, error } = await admin.rpc('enqueue_content_digest', {
      p_semana: SEMANA,
      p_limiar: LIMIAR_ABA_PT,
    })
    if (error) throw new Error(error.message)
    const linhas = Number(data ?? 0)
    if (linhas === 0) {
      // Achado 11 do Sol: zero tem DUAS causas, e dizer só a primeira é mentira
      // no log — o toque desta rodada pode já ter saído numa corrida anterior.
      console.log('  nenhum toque novo na fila. Ou a varredura não trouxe cartão nenhum')
      console.log('    nesta rodada, ou o toque desta rodada já foi ENVIADO (e linha enviada')
      console.log('    não se reescreve — a dona leria um número que nunca recebeu).')
      return
    }
    console.log(`  ✔ ${linhas} toque(s) na fila — 1 por admin, dedupe pela rodada ${SEMANA}`)
    console.log('    (o despachante manda no próximo ciclo, respeitando o silêncio de 21h–8h)')
  })
}

/* ========================================================================== */
/* Relatório                                                                   */
/* ========================================================================== */

function tamanhoDaPasta(caminho: string): number {
  const raiz = join(process.cwd(), caminho)
  if (!existsSync(raiz)) return 0
  let total = 0
  const andar = (dir: string): void => {
    for (const nome of readdirSync(dir)) {
      const cheio = join(dir, nome)
      const st = statSync(cheio)
      if (st.isDirectory()) andar(cheio)
      else total += st.size
    }
  }
  andar(raiz)
  return total
}

function relatorio(quota: QuotaGasta, apify: CorridaApify): void {
  secao('RESUMO DA CORRIDA')
  console.log(`  análises novas: ${custo.analises} · puladas por já existirem: ${custo.puladas} · transcrições reaproveitadas: ${custo.reaproveitadas}`)
  console.log(`  YouTube: ~${quota.unidades} unidades de quota (teto diário 10.000)`)
  console.log(`  Apify: ${apify.custo.itens} itens · US$ ${apify.custo.estimadoUsd.toFixed(2)} ESTIMADOS (a fatura real é do painel)`)
  console.log(`  Gemini: ${custo.tokensGemini.toLocaleString('pt-BR')} tokens`)
  console.log(`  Claude: US$ ${custo.claudeUsd.toFixed(3)} estimados`)
  console.log(`  Haiku (notas de viagem): US$ ${custo.haikuUsd.toFixed(3)} estimados`)
  const bytes = tamanhoDaPasta(PASTA_MIDIA)
  console.log(`  mídia guardada em ${PASTA_MIDIA}: ${(bytes / 1024 / 1024).toFixed(1)} MB (nada é apagado — ADR-031, adendo 01/08)`)

  if (avisos.length) {
    console.log(`\n  avisos do insumo (${avisos.length}):`)
    for (const a of [...new Set(avisos)].slice(0, 10)) console.log(`    · ${a}`)
  }
  if (falhas.length) {
    console.log(`\n  ✗ fontes que falharam (${falhas.length}) — as outras seguiram:`)
    for (const f of falhas) console.log(`    · ${f}`)
  }
}

/* ========================================================================== */
/* Main                                                                        */
/* ========================================================================== */

function exigeEnv(nome: string): string {
  const v = process.env[nome]
  if (!v) throw new Error(`${nome} ausente — defina no .env.local`)
  return v
}

function estimativaInicial(criadores: readonly CriadorCadastrado[]): void {
  // A estimativa vem ANTES, sempre — informação, nunca trava (decisão do dono).
  // Desde a Leva 1.1 ela é função pura do CADASTRO REAL e das flags — o "7"
  // hardcoded e o buraco dos perfis morreram em `src/lib/research/estimativa.ts`.
  const e = estimativaDaCorrida(criadores, {
    so: SO === 'criadores' || SO === 'trends' ? SO : undefined,
    rede: SO_REDE as Rede | undefined,
  })
  console.log(`Apify: ~US$ ${e.usdApify.toFixed(2)} estimados nesta corrida:`)
  for (const linha of e.linhas) console.log(`  ${linha}`)
  console.log(`Reels a analisar: até ${e.reels} (~US$ 0,04 cada em Claude, mais Gemini).`)
}

function clienteAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL / SERVICE_ROLE_KEY ausentes')
  return createClient(url, key, { auth: { persistSession: false } })
}


async function corridaDePesquisa(admin: SupabaseClient): Promise<void> {
  if (SO && !['criadores', 'trends', 'estimativa'].includes(SO)) {
    throw new Error(`--so=${SO} inválido (use criadores, trends ou estimativa)`)
  }
  console.log(`Pesquisa de pauta — semana ${SEMANA}${FORCE ? ' · --force (refaz a janela)' : ''}`)

  const criadores = await criadoresDoCadastro(admin)
  estimativaInicial(criadores)
  if (SO === 'estimativa') {
    console.log('\n--so=estimativa: nada foi coletado nem gasto — a corrida para aqui.')
    return
  }

  const quota: QuotaGasta = { unidades: 0 }
  const apify: CorridaApify = {
    corrida: `${SEMANA}-${new Date().toISOString().slice(11, 16).replace(':', '')}`,
    token: process.env.APIFY_TOKEN ?? '',
    custo: { estimadoUsd: 0, itens: 0 },
  }
  if (!apify.token) {
    // Não derruba a corrida: YouTube e Reddit seguem. Mas fica REGISTRADO como
    // falha, e o exitCode reflete.
    falhas.push('APIFY_TOKEN ausente — Instagram, TikTok e X ficaram de fora')
    process.exitCode = 1
    console.warn('\n⚠ APIFY_TOKEN ausente: Instagram, TikTok e X ficam de fora desta corrida.')
  }

  const candidatos: CandidatoAAnalise[] = []
  const chavesDeTrends = REDES.filter((r) => !SO_REDE || r === SO_REDE).map((r) => chaveDosTrends(r, SEMANA))
  const ativosDeTrends = await ativosPorFonte(admin, chavesDeTrends)

  if (SO !== 'trends') candidatos.push(...(await etapaCriadores(admin, quota, apify, criadores)))
  if (SO !== 'criadores') candidatos.push(...(await etapaTrends(admin, quota, apify, ativosDeTrends)))
  await etapaAnalises(admin, candidatos)
  await etapaRadarDoWorker(admin)

  relatorio(quota, apify)
  await digestDoLote(admin)
}

async function main(): Promise<void> {
  if (SUBCOMANDO === 'ideias') {
    throw new Error(
      'o subcomando `ideias` foi aposentado na Leva 6.2: ele abastecia o Portão 1, ' +
        'que morreu no cutover do radar. Rode `npm run worker:pesquisa` — a varredura ' +
        'traz as trends e o radar é onde você decide.',
    )
  }
  if (SUBCOMANDO) {
    throw new Error(`subcomando desconhecido: "${SUBCOMANDO}" (este worker só tem a varredura)`)
  }
  return corridaDePesquisa(clienteAdmin())
}

main().catch((err) => {
  console.error('\n✗ research-pipeline falhou:', (err as Error).message)
  process.exit(1)
})
