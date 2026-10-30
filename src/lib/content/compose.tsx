import type { ReactElement } from 'react'

// Cartões finais do carrossel/story (ADR-021, arquitetura de duas camadas da
// Lei 11): TODO slide tem a sua própria cena de fundo, gerada a partir do texto
// daquele slide, e o texto é composto por cima deterministicamente. A cena não
// segue a paleta da marca — quem carrega a marca é a composição: névoa na base,
// selo fixo e o termo-alvo na faixa roxa.
//
// Feedback do mantenedor (21/07, depois da primeira rodada real): "cada slide ter
// uma foto gerada diferente, de acordo com o conteúdo". A capa aceita DOIS
// modos com o mesmo desenho — foto real da Teacher Vicky ou cena gerada —, porque o que
// muda é só a imagem de fundo. Emoji é proibido na capa.
//
// Renderização via ImageResponse (next/og) com a fonte default embutida (Geist).
// Cores: tokens do Design.md ("Papel & Tinta").
const INK = '#17141F'
const INK_600 = '#4C4859'
const PAPER = '#F7F7FB'
const BRAND = '#7E36A3'
const BRAND_FILL = '#F3E9FA'

/** Identificador que assina o cartão. Vem de config (CONTENT_HANDLE); padrão neutro. */
export const HANDLE = process.env.CONTENT_HANDLE?.trim() || '@escola'

/** Rodapé do cartão: identificador + nome da escola. */
export const RODAPE = `${HANDLE} · Personal Teacher Academy`

export function cardSize(kind: string): { width: number; height: number } {
  return kind === 'story' ? { width: 1080, height: 1920 } : { width: 1080, height: 1350 }
}

export interface Slide {
  ordem: number
  titulo?: string
  texto: string
  /** Expressão-alvo em inglês, entregue pelo gerador. É o herói do cartão: vai
   *  para a faixa da marca. Sem ele, o desenho cai na heurística de extrairTermo. */
  termo?: string
  prompt_imagem?: string
}

/** Emoji fora da capa (regra do mantenedor, 21/07). Cobre pictogramas, símbolos,
 *  bandeiras e o seletor de variação; a seta do próprio layout não passa por
 *  aqui, então continua desenhada. */
export function semEmoji(texto: string): string {
  const re =
    /[\u{1F000}-\u{1FAFF}\u{1F900}-\u{1F9FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/gu
  return texto.replace(re, '').replace(/\s{2,}/g, ' ').trim()
}

/** Trecho em MAIÚSCULAS vira grifo: 1ª palavra com 3+ letras; palavras curtas
 *  em caps (I, A, TO) continuam o mesmo grifo ("CAN I HAVE" é UM destaque).
 *  Apóstrofo reto e tipográfico contam (I'LL / I’LL). */
export function splitHighlights(texto: string): Array<{ text: string; hl: boolean }> {
  const re = /[A-ZÀ-Ü][A-ZÀ-Ü'’-]{2,}(?:\s+[A-ZÀ-Ü][A-ZÀ-Ü'’-]*)*/g
  const out: Array<{ text: string; hl: boolean }> = []
  let last = 0
  for (const m of texto.matchAll(re)) {
    const i = m.index ?? 0
    if (i > last) out.push({ text: texto.slice(last, i), hl: false })
    out.push({ text: m[0], hl: true })
    last = i + m[0].length
  }
  if (last < texto.length) out.push({ text: texto.slice(last), hl: false })
  return out.filter((p) => p.text.length > 0)
}

/** O termo-alvo é o herói do cartão (padrão Wise Up: foto + a expressão grande
 *  na faixa da marca).
 *
 *  A v1 adivinhava pela POSIÇÃO — assumia que o trecho em maiúsculas do fim era
 *  o alvo — e quebrou no primeiro post real: o gerador escreveu a expressão
 *  entre aspas no meio da frase e terminou com "demonstra total CONFIANÇA",
 *  então a faixa estampou CONFIANÇA em vez de I'D LIKE A FLAT WHITE, PLEASE.
 *  Agora o gerador entrega o campo `termo` explícito e não há o que adivinhar;
 *  a heurística abaixo é só a rede para os posts gerados antes disso, e escolhe
 *  o trecho MAIS LONGO (o vocabulário-alvo costuma ser uma expressão inteira;
 *  palavra solta em caixa alta é ênfase, não a lição).
 *
 *  O corpo devolve as partes com grifo preservado — quando o termo fica no meio
 *  da frase, tirá-lo deixaria um buraco ("Você aprendeu a dizer «»"), então ele
 *  continua no texto, grifado, e a faixa some. */
export function extrairTermo(texto: string, termoExplicito?: string): {
  partes: Array<{ text: string; hl: boolean }>
  termo: string | null
} {
  const partes = splitHighlights(texto)
  const limpaFim = (ps: Array<{ text: string; hl: boolean }>) => {
    const out = ps.slice()
    const ultima = out.at(-1)
    if (ultima && !ultima.hl) {
      const cortado = ultima.text.replace(/[\s.,;:—-]+$/, '')
      if (cortado) out[out.length - 1] = { ...ultima, text: cortado }
      else out.pop()
    }
    return out
  }

  if (termoExplicito?.trim()) {
    const termo = termoExplicito.trim()
    // Se o texto termina no próprio termo, ele sai do corpo (não repete).
    const ultima = partes.at(-1)
    const penultima = partes.at(-2)
    if (ultima?.hl && ultima.text.trim() === termo) {
      return { partes: limpaFim(partes.slice(0, -1)), termo }
    }
    if (penultima?.hl && penultima.text.trim() === termo && /^[\s.!?…]*$/.test(ultima?.text ?? '')) {
      return { partes: limpaFim(partes.slice(0, -2)), termo }
    }
    return { partes, termo }
  }

  const candidatos = partes.filter((p) => p.hl)
  if (candidatos.length === 0) return { partes, termo: null }
  let escolhido = candidatos[0]
  for (const c of candidatos) {
    if (c.text.trim().length >= escolhido.text.trim().length) escolhido = c
  }
  // Só vira faixa se estiver no fim; no meio, fica grifado dentro do texto.
  const ultima = partes.at(-1)
  const penultima = partes.at(-2)
  if (ultima === escolhido && partes.length > 1) {
    return { partes: limpaFim(partes.slice(0, -1)), termo: escolhido.text.trim() }
  }
  if (penultima === escolhido && partes.length > 2 && /^[\s.!?…]*$/.test(ultima?.text ?? '')) {
    return { partes: limpaFim(partes.slice(0, -2)), termo: escolhido.text.trim() }
  }
  return { partes, termo: null }
}

/** Selo da marca no mesmo canto de TODOS os cartões — é o que costura o
 *  carrossel visualmente quando cada slide tem uma cena diferente (padrão
 *  verificado na Fluency, 21/07). */
function seloMarca(marcaDataUrl: string | null, width: number): ReactElement {
  const d = Math.round(width * 0.105)
  return (
    <div
      style={{
        position: 'absolute',
        top: Math.round(width * 0.05),
        right: Math.round(width * 0.05),
        width: d,
        height: d,
        borderRadius: 999,
        backgroundColor: BRAND,
        border: '3px solid rgba(255,255,255,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {marcaDataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- satori não usa next/image
        <img
          src={marcaDataUrl}
          alt=""
          width={Math.round(d * 0.58)}
          height={Math.round(d * 0.58)}
          style={{ objectFit: 'contain' }}
        />
      ) : (
        <div style={{ display: 'flex', color: '#FFFFFF', fontSize: Math.round(d * 0.36), fontWeight: 700 }}>
          PT
        </div>
      )}
    </div>
  )
}

/** Névoa da base: garante contraste do texto sobre QUALQUER cena, sem depender
 *  de sorte na imagem gerada. `forte` escurece o cartão inteiro (fechamento). */
function nevoa(width: number, height: number, forte = false): ReactElement {
  return (
    <div
      style={{
        position: 'absolute',
        top: forte ? 0 : Math.round(height * 0.38),
        left: 0,
        width,
        height: forte ? height : Math.round(height * 0.62),
        background: forte
          ? 'linear-gradient(180deg, rgba(23,20,31,0.62) 0%, rgba(23,20,31,0.9) 100%)'
          : 'linear-gradient(180deg, rgba(23,20,31,0) 0%, rgba(23,20,31,0.62) 38%, rgba(23,20,31,0.94) 100%)',
      }}
    />
  )
}

function fundo(cenaDataUrl: string | null, width: number, height: number): ReactElement | null {
  if (!cenaDataUrl) return null
  return (
    // eslint-disable-next-line @next/next/no-img-element -- satori não usa next/image
    <img
      src={cenaDataUrl}
      alt=""
      width={width}
      height={height}
      style={{ position: 'absolute', top: 0, left: 0, width, height, objectFit: 'cover' }}
    />
  )
}

/** Capa: cena (gerada OU foto real da Teacher Vicky — mesmo desenho, muda só a imagem)
 *  + gancho CURTO como maior elemento do card, em CAIXAS ROXAS por linha, que
 *  garantem contraste programaticamente. Fonte escala pelo tamanho do gancho. */
export function capaCard(opts: {
  fotoDataUrl: string | null
  gancho: string
  kind: string
  marcaDataUrl?: string | null
}): ReactElement {
  const { width, height } = cardSize(opts.kind)
  const gancho = semEmoji(opts.gancho)
  const palavras = gancho.trim().split(/\s+/).filter(Boolean)
  const linhas: string[] = []
  for (let i = 0; i < palavras.length; i += 3) linhas.push(palavras.slice(i, i + 3).join(' '))
  const fontSize = palavras.length <= 6 ? 92 : palavras.length <= 9 ? 76 : 62
  return (
    <div
      style={{
        width,
        height,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        backgroundColor: INK,
        position: 'relative',
      }}
    >
      {fundo(opts.fotoDataUrl, width, height)}
      {nevoa(width, height)}
      {seloMarca(opts.marcaDataUrl ?? null, width)}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          padding: 72,
          paddingBottom: 84,
          gap: 0,
        }}
      >
        {linhas.map((linha, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              backgroundColor: BRAND,
              color: '#FFFFFF',
              fontSize,
              lineHeight: 1.1,
              padding: '10px 26px',
              marginTop: i === 0 ? 0 : 6,
            }}
          >
            {linha}
          </div>
        ))}
        <div
          style={{
            display: 'flex',
            width: width - 144,
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 30,
          }}
        >
          <div style={{ display: 'flex', fontSize: 28, color: 'rgba(255,255,255,0.85)' }}>
            {RODAPE}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 68,
              height: 68,
              borderRadius: 999,
              backgroundColor: 'rgba(255,255,255,0.92)',
              color: INK,
              fontSize: 36,
            }}
          >
            →
          </div>
        </div>
      </div>
    </div>
  )
}

/** Cartão interno COM cena: eyebrow (a referência — filme, série, situação),
 *  o texto explicativo e o termo-alvo na faixa roxa. O ÚLTIMO slide (cta) usa
 *  névoa forte e inverte a faixa para branco, fechando o carrossel. */
export function cenaCard(opts: {
  slide: Slide
  total: number
  kind: string
  cenaDataUrl: string | null
  marcaDataUrl?: string | null
  cta?: boolean
}): ReactElement {
  const { width, height } = cardSize(opts.kind)
  const { partes, termo } = extrairTermo(opts.slide.texto, opts.slide.termo)
  const destaque = opts.cta ? opts.slide.titulo || termo : termo
  return (
    <div
      style={{
        width,
        height,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        backgroundColor: INK,
        position: 'relative',
      }}
    >
      {fundo(opts.cenaDataUrl, width, height)}
      {nevoa(width, height, opts.cta)}
      {seloMarca(opts.marcaDataUrl ?? null, width)}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          padding: 72,
          paddingBottom: 88,
          gap: 22,
        }}
      >
        {!opts.cta && opts.slide.titulo && (
          <div
            style={{
              display: 'flex',
              fontSize: 28,
              letterSpacing: 5,
              color: 'rgba(255,255,255,0.72)',
            }}
          >
            {opts.slide.titulo.toUpperCase()}
          </div>
        )}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            fontSize: 44,
            lineHeight: 1.38,
            color: '#FFFFFF',
            maxWidth: width - 160,
          }}
        >
          {partes.map((p, i) =>
            p.hl ? (
              // Expressão em caixa alta que ficou no meio da frase: destaque na
              // cor da marca, para não sumir no meio do texto branco.
              <span
                key={i}
                style={{
                  backgroundColor: BRAND,
                  color: '#FFFFFF',
                  borderRadius: 8,
                  padding: '0 10px',
                  margin: '0 2px',
                }}
              >
                {p.text}
              </span>
            ) : (
              <span key={i}>{p.text}</span>
            ),
          )}
        </div>
        {destaque && (
          <div
            style={{
              display: 'flex',
              backgroundColor: opts.cta ? '#FFFFFF' : BRAND,
              color: opts.cta ? BRAND : '#FFFFFF',
              fontSize: opts.cta ? 64 : 78,
              lineHeight: 1.1,
              padding: '10px 26px',
            }}
          >
            {destaque}
          </div>
        )}
      </div>
      <div
        style={{
          position: 'absolute',
          right: 72,
          bottom: 44,
          display: 'flex',
          fontSize: 26,
          color: 'rgba(255,255,255,0.6)',
        }}
      >
        {opts.slide.ordem}/{opts.total}
      </div>
    </div>
  )
}

/** Rede de segurança: quando a cena daquele slide faltou (geração falhou, post
 *  antigo), o cartão cai para texto sobre papel em vez de sair preto. */
export function textoCard(opts: {
  slide: Slide
  total: number
  kind: string
  cta?: boolean
  marcaDataUrl?: string | null
}): ReactElement {
  const { width, height } = cardSize(opts.kind)
  const partes = splitHighlights(opts.slide.texto)
  const fundoCor = opts.cta ? BRAND : PAPER
  const corTitulo = opts.cta ? '#FFFFFF' : INK
  const corTexto = opts.cta ? 'rgba(255,255,255,0.94)' : INK_600
  const corEyebrow = opts.cta ? 'rgba(255,255,255,0.7)' : BRAND
  const hlBg = opts.cta ? '#FFFFFF' : BRAND_FILL
  const hlCor = BRAND
  return (
    <div
      style={{
        width,
        height,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        backgroundColor: fundoCor,
        padding: 84,
        position: 'relative',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
        <div style={{ display: 'flex', fontSize: 26, letterSpacing: 4, color: corEyebrow }}>
          PERSONAL TEACHER
        </div>
        {opts.slide.titulo && (
          <div style={{ display: 'flex', fontSize: 58, lineHeight: 1.15, color: corTitulo }}>
            {opts.slide.titulo}
          </div>
        )}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            fontSize: opts.slide.titulo ? 42 : 50,
            lineHeight: 1.45,
            color: corTexto,
          }}
        >
          {partes.map((p, i) =>
            p.hl ? (
              <span
                key={i}
                style={{
                  backgroundColor: hlBg,
                  color: hlCor,
                  borderRadius: 10,
                  padding: '0 12px',
                  margin: '0 2px',
                }}
              >
                {p.text}
              </span>
            ) : (
              <span key={i}>{p.text}</span>
            ),
          )}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', fontSize: 26, color: opts.cta ? 'rgba(255,255,255,0.8)' : INK_600 }}>
          {HANDLE}
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 26,
            color: BRAND,
            backgroundColor: opts.cta ? '#FFFFFF' : BRAND_FILL,
            borderRadius: 999,
            padding: '6px 22px',
          }}
        >
          {opts.slide.ordem}/{opts.total}
        </div>
      </div>
    </div>
  )
}
