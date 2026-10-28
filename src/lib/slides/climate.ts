// Template v2 / Fase 0a — CLIMA por PARTE do curso.
//
// O curso Personal Travel tem 6 PARTES nomeadas (achado da extração da planilha
// da Teacher Vicky — `docs/research/06-mapa-do-curso-completo.md` §1), e não só 12
// módulos. A PARTE é a unidade natural da única variação "de ambiente" que a
// pesquisa sustenta: variar o contexto ENTRE sessões ajudou retenção em 5 dias
// (Smith & Rothkopf 1984, via `docs/research/05` §3.5), enquanto variação
// arbitrária por aula não tem evidência nenhuma.
//
// LIMITE DURO: o clima NÃO toca a gramática de cor (roxo = marca/ação, teal =
// positivo, âmbar = tip, danger = erro). Fog é FUNDO, nunca sinal — os seis
// fundos ficam todos dentro da família noturna periwinkle/ciano da marca.
// Módulo puro: sem I/O, sem dependência do renderer.

export type PartId = 1 | 2 | 3 | 4 | 5 | 6

/**
 * Chave de módulo. GET READY não é módulo numerado (`slide_lessons.module` tem
 * `check (module between 1 and 12)`), então ele entra por nome — e `0` é aceito
 * como sinônimo para quem só tem o número em mão.
 */
export type ModuleKey = number | 'get-ready'

export interface Climate {
  part: PartId
  /** nome da PARTE como está na planilha da Teacher Vicky */
  partTitle: string
  /** nome-base do fog em brand/slides/assets (sem extensão) */
  fog: string
  /** como o fog foi construído — texto de auditoria, não parâmetro de render */
  fogNote: string
  /** direção fotográfica da PARTE (insumo dos prompts do Gemini — Frente B) */
  photo: string
}

interface PartSpec extends Climate {
  /** módulos cobertos pela PARTE ('get-ready' entra na PARTE 1) */
  modules: ReadonlyArray<ModuleKey>
}

export const PARTS: ReadonlyArray<PartSpec> = [
  {
    part: 1,
    partTitle: 'THE PILLARS OF FLUENCY',
    modules: ['get-ready', 1],
    fog: 'fog-p1',
    fogNote: 'periwinkle base',
    photo: 'interior de estudo, luz de manhã, quente-neutro',
  },
  {
    part: 2,
    partTitle: 'FIRST STEPS',
    modules: [2, 3, 4],
    fog: 'fog-p2',
    fogNote: 'periwinkle → ciano frio',
    photo: 'aeroporto/hotel, luz fria de terminal',
  },
  {
    part: 3,
    partTitle: 'TIME TO TOUR',
    modules: [5, 6, 7],
    fog: 'fog-p3',
    fogNote: 'ciano quente',
    photo: 'rua e cidade, fim de tarde dourado',
  },
  {
    part: 4,
    partTitle: 'FRIENDS & NETWORKING',
    modules: [8, 9],
    fog: 'fog-p4',
    fogNote: 'periwinkle suave',
    photo: 'cafés e praças, luz difusa',
  },
  {
    part: 5,
    partTitle: 'EMERGENCIES',
    modules: [10, 11],
    fog: 'fog-p5',
    fogNote: 'ciano neutro, mais escuro',
    photo: 'clínica/estação, luz clara neutra, sem drama',
  },
  {
    part: 6,
    partTitle: 'READY TO GO',
    modules: [12],
    fog: 'fog-p6',
    fogNote: 'periwinkle luminoso',
    photo: 'horizonte/viagem, luz clara e otimista',
  },
] as const

/** `0` e `'get-ready'` são a mesma coisa: a introdução, dentro da PARTE 1. */
function normalize(module: ModuleKey): ModuleKey {
  return module === 0 || module === 'get-ready' ? 'get-ready' : Math.trunc(module)
}

/**
 * Clima do módulo. Módulo fora do mapa é ERRO, não fallback silencioso: um
 * módulo 13 significa que o mapa do curso mudou e alguém precisa decidir a
 * PARTE dele (fail-fast, CLAUDE.md §3).
 */
export function climateFor(module: ModuleKey): Climate {
  const key = normalize(module)
  const found = PARTS.find((p) => p.modules.includes(key))
  if (!found) {
    throw new RangeError(
      `sem PARTE mapeada para o módulo ${String(module)} — o curso tem GET READY + M1–M12 (docs/research/06 §1)`,
    )
  }
  return {
    part: found.part,
    partTitle: found.partTitle,
    fog: found.fog,
    fogNote: found.fogNote,
    photo: found.photo,
  }
}

/** todos os nomes de fog que o build de assets precisa produzir */
export function fogNames(): string[] {
  return PARTS.map((p) => p.fog)
}
