// VOCABULÁRIO E ENDEREÇO DA AGENDA (Onda da Agenda · A1) — o único lugar que
// nomeia as visões e monta a URL da seção. Módulo PURO: sem `server-only`, sem
// query, testável linha a linha.
//
// A DEPENDÊNCIA APONTA PARA CÁ, não daqui para o `agenda.ts`: aquele módulo é
// `server-only` e importá-lo aqui contaminaria o puro (e o teste de unidade não
// conseguiria carregar este arquivo). É o mesmo corte de `alunos-grupos.ts`
// (puro) × `alunos.ts` (servidor).
//
// Por que ele existe: a agenda tem cinco dimensões de estado na URL (visão,
// âncora, professora, camada de horários, busca) e a tela velha remontava a
// query string em quatro lugares diferentes — a barra de tempo, os chips de
// visão, os chips de professora e o `back=` das actions. Quatro cópias da mesma
// regra é como um filtro sobrevive numa navegação e some na outra.
//
// REGRA DO ENDEREÇO CURTO: só viaja na URL o que DIFERE do padrão. A tela em
// repouso (`semana`, hoje, todas as professoras, horários ligados) é
// `/admin/agenda` limpo — link salvo curto e legível, e o "Hoje" da barra volta
// a ser o endereço da casa.

export const VISOES = ['dia', 'semana', 'mes', 'lista'] as const
export type VisaoDaGrade = (typeof VISOES)[number]
/** `pendencias` é ABA do card-contêiner, não visão da grade (e `periodo` é rota
 *  própria). Por isso ela entra no tipo da URL, mas fora de `VISOES`. */
export type VisaoDaAgenda = VisaoDaGrade | 'pendencias'

export const VISAO_ROTULO: Record<VisaoDaGrade, string> = {
  dia: 'Dia',
  semana: 'Semana',
  mes: 'Mês',
  lista: 'Lista',
}

export function ehVisaoDaGrade(v: string | undefined): v is VisaoDaGrade {
  return VISOES.includes((v ?? '') as VisaoDaGrade)
}

export const VISAO_PADRAO: VisaoDaGrade = 'semana'

export interface EstadoDaAgenda {
  visao: VisaoDaAgenda
  /** 'yyyy-LL-dd'; igual a hoje não viaja */
  ancora?: string
  /** id da professora; ausente = todas */
  professora?: string
  /** camada de horários publicados — LIGADA por padrão */
  comJanelas: boolean
  /** busca por aluno (só faz sentido na visão lista) */
  busca?: string
}

export function ehVisaoDaAgenda(v: string | undefined): v is VisaoDaAgenda {
  return v === 'pendencias' || VISOES.includes((v ?? '') as VisaoDaGrade)
}

/**
 * O que o Next entrega em `searchParams`: `?q=a&q=b` chega como ARRAY.
 *
 * SOL · achado 14: o tipo declarava tudo como `string`, e `sp.q?.trim()`
 * lançava `TypeError` num link com parâmetro repetido; um `prof` repetido virava
 * filtro-array e esvaziava a agenda. Parâmetro repetido não é ataque nem erro
 * do usuário — acontece em link encaminhado, integração e edição manual. Fica a
 * regra do primeiro valor, que é o que o navegador mostraria na barra.
 */
export type ValorDaQuery = string | string[] | undefined
export function primeiroValor(v: ValorDaQuery): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

/** Lê o estado da query string, com os padrões da seção aplicados. */
export function estadoDaQuery(sp: {
  v?: ValorDaQuery
  d?: ValorDaQuery
  prof?: ValorDaQuery
  j?: ValorDaQuery
  q?: ValorDaQuery
}): EstadoDaAgenda {
  const v = primeiroValor(sp.v)
  const d = primeiroValor(sp.d)
  const prof = primeiroValor(sp.prof)
  const j = primeiroValor(sp.j)
  const q = primeiroValor(sp.q)
  return {
    visao: ehVisaoDaAgenda(v) ? v : VISAO_PADRAO,
    // Só o FORMATO é conferido aqui (módulo puro, sem relógio). Data civil
    // inexistente (`2026-02-30`) passa neste crivo e é derrubada pelo Luxon na
    // camada de dados, que é quem sabe o fuso do negócio (achado 13).
    ancora: d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined,
    professora: prof || undefined,
    // `j=0` é a única forma de desligar: ausência significa LIGADA.
    comJanelas: j !== '0',
    busca: q?.trim() || undefined,
  }
}

/**
 * Monta a URL da agenda.
 *
 * `hojeISO` entra por parâmetro (e não é lido de um relógio aqui) porque este
 * módulo é puro: quem sabe que dia é hoje no fuso do NEGÓCIO é a camada de
 * dados, e "hoje" é justamente a âncora que não precisa viajar.
 */
export function enderecoDaAgenda(e: EstadoDaAgenda, hojeISO: string): string {
  const p = new URLSearchParams()
  if (e.visao !== VISAO_PADRAO) p.set('v', e.visao)
  // SOL · achado 15: omitir a âncora quando ela é HOJE deixa o endereço móvel —
  // certo para semana/mês (o link "a agenda" deve abrir na semana de quem
  // abriu), errado para o DIA, onde o endereço nomeia uma data. Um favorito de
  // "a agenda de 28/07" virava "a agenda de amanhã" ao ser reaberto.
  if (e.ancora && (e.ancora !== hojeISO || e.visao === 'dia')) p.set('d', e.ancora)
  if (e.professora) p.set('prof', e.professora)
  // A camada de horários só existe nas visões de GRADE — carregar `j=0` numa
  // lista deixaria lixo no endereço e ressuscitaria o estado ao voltar à grade.
  if (!e.comJanelas && e.visao !== 'lista' && e.visao !== 'pendencias') p.set('j', '0')
  if (e.busca && e.visao === 'lista') p.set('q', e.busca)
  const s = p.toString()
  return s ? `/admin/agenda?${s}` : '/admin/agenda'
}

/** Atalho: o mesmo estado com uma dimensão trocada. */
export function comMudanca(
  e: EstadoDaAgenda,
  mudanca: Partial<EstadoDaAgenda>,
  hojeISO: string,
): string {
  return enderecoDaAgenda({ ...e, ...mudanca }, hojeISO)
}
