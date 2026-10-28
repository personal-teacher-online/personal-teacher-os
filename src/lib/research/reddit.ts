// PESQUISA DE PAUTA — Reddit (M5).
//
// A fonte mais barata e a de natureza diferente das outras quatro: aqui não há
// vídeo nem criador cadastrado — há gente descrevendo o próprio problema com as
// palavras dela. É insumo de PAUTA (o que dói), não de formato (como se filma).
//
// ── POR QUE O FEED ATOM, E NÃO O `.json` ────────────────────────────────────
// Medido em 01/08/2026, da máquina do mantenedor: `/r/<sub>/top.json`,
// `/r/<sub>.json`, `api.reddit.com` e `search.json` devolvem **403** para
// qualquer User-Agent — o Reddit fechou o JSON público para cliente sem OAuth.
// O que continua respondendo 200 é `/r/<sub>/top.rss` (Atom). Trocar por OAuth
// exigiria registrar um app e duas envs novas; o feed entrega o que a pesquisa
// precisa (o que subiu na semana, na ordem em que subiu) sem chave nenhuma —
// que é o que o plano do M5 prometeu.
//
// O PREÇO, declarado: o Atom **não traz upvotes nem comentários**. Não há
// número público a medir aqui, então `ENGAJAMENTO_MINIMO.reddit` é 0 e o que
// fica registrado como métrica é a POSIÇÃO no top da semana — que é medida, e
// é o próprio ranking de engajamento do Reddit, só que ordinal.

import { TOP_POR_FONTE } from './config.ts'
import type { ItemDaPesquisa } from './tipos.ts'

const UA = 'personal-teacher-os/1.0 (pesquisa de pauta da Personal Teacher Online)'

/** Uma tag simples do Atom, sem arrastar um parser de XML para o projeto. */
function tag(entrada: string, nome: string): string {
  const m = new RegExp(`<${nome}[^>]*>([\\s\\S]*?)</${nome}>`).exec(entrada)
  return m ? decodificar(m[1].trim()) : ''
}

function decodificar(texto: string): string {
  return texto
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function esperar(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** 429 é a resposta NORMAL do Reddit a quem insiste; esperar é o remédio. */
async function baixarFeed(sub: string): Promise<string> {
  let ultimo = 0
  for (const espera of [0, 5_000, 15_000, 30_000]) {
    if (espera) await esperar(espera)
    const r = await fetch(`https://www.reddit.com/r/${sub}/top.rss?t=week`, {
      headers: { 'user-agent': UA, accept: 'application/atom+xml' },
      signal: AbortSignal.timeout(60_000),
    })
    if (r.ok) return r.text()
    ultimo = r.status
    if (r.status !== 429 && r.status < 500) break
  }
  throw new Error(`Reddit r/${sub}: HTTP ${ultimo}`)
}

/**
 * O top da semana de cada subreddit.
 *
 * `t=week` casa com a janela do `source_key` de trends: a pesquisa da semana
 * olha o que subiu naquela semana.
 */
export async function trendsDoReddit(
  subreddits: readonly string[],
  avisos: string[],
): Promise<ItemDaPesquisa[]> {
  const itens: ItemDaPesquisa[] = []

  for (const [n, sub] of subreddits.entries()) {
    // O Reddit limita por IP com mão pesada — pedir três feeds em rajada rende
    // 429 no segundo. Um respiro entre eles custa segundos e evita a corrida
    // inteira do fórum falhar por pressa.
    if (n > 0) await esperar(2_000)
    const xml = await baixarFeed(sub)

    const entradas = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? []
    if (!entradas.length) avisos.push(`r/${sub}: feed sem entradas`)

    let posicao = 0
    for (const entrada of entradas.slice(0, TOP_POR_FONTE * 2)) {
      posicao += 1
      // `<id>t3_abc123</id>` — o `t3_` é o prefixo de "post" do Reddit.
      const id = tag(entrada, 'id').replace(/^t3_/, '')
      const titulo = tag(entrada, 'title')
      const link = /<link[^>]*href="([^"]+)"/.exec(entrada)?.[1] ?? ''
      if (!id || !titulo) {
        avisos.push(`post do Reddit sem id/título em r/${sub} — descartado`)
        continue
      }
      itens.push({
        rede: 'reddit',
        id,
        url: decodificar(link),
        // O subreddit entra no título de propósito: é ele que diz "isto é sobre
        // idioma" para o filtro por palavra, já que muito título de post não
        // repete o assunto do fórum ("How do I stop translating in my head?").
        titulo: `[r/${sub}] ${titulo}`,
        autor: tag(entrada, 'name'),
        publicadoEm: tag(entrada, 'updated') || null,
        duracaoS: null,
        // Sem número público no feed; a posição é o que dá para medir.
        metricas: { posicao_no_top: posicao },
      })
    }
  }

  return itens
}
