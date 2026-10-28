// AULAS DO PORTAL (Onda do Portal · P4) — o que estas quatro telas dizem, sem
// navegador:
//
//   1. estado da aula → frase de gente, para TODOS os estados de `class_state`
//      (e para o estado que ainda não existe);
//   2. a consequência de remarcar/cancelar agora → uma frase por efeito que o
//      banco sabe devolver, sem buraco;
//   3. um varredor que lê as quatro telas NA FONTE atrás do vocabulário morto
//      (jargão de ledger, data de máquina) e da régua do P3: nenhuma tela de
//      regra ou de dinheiro decide o dia civil por conta própria;
//   4. o fim do `?msg=` NESTAS telas (a ponte de nonce não pode voltar por
//      distração) e a fronteira que ficou no lugar dele: cookie de uso único +
//      redirect, que fala COM e SEM JavaScript;
//   5. o prazo da resposta (E2): o preview é uma foto do agora, e a tela avisa
//      quando essa foto está a minutos de vencer.
//
// A prova de que o PREVIEW bate com o EFEITO REAL é de integração e mora em
// `tests/portal-p4-efeito.test.ts` (precisa do banco).
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  estadoDaAula,
  fraseDeCancelarAgora,
  fraseDeRemarcarAgora,
  fraseDoLimite,
  limiteApertado,
  podeCancelar,
  podeRemarcar,
  type EfeitoDeCancelar,
  type EfeitoDeRemarcar,
} from '@/lib/portal/aulas'
import { PROIBIDO, varrerVocabulario } from './helpers/vocabulario'

/* -------------------------------------------------------------------------- */
/* 1. estado da aula → frase de gente                                          */
/* -------------------------------------------------------------------------- */

/** Os seis estados do enum `class_state` (migration 20260711000200). Estado novo
 *  no schema entra aqui — e o teste de baixo cobra frase para ele. */
const ESTADOS_DO_SCHEMA = [
  'scheduled',
  'completed',
  'no_show_student',
  'no_show_teacher',
  'cancelled',
  'rescheduled',
] as const

describe('estadoDaAula — todo estado do schema vira português', () => {
  it('realizada, remarcada e as duas faltas têm nome', () => {
    expect(estadoDaAula({ estado: 'completed' }).frase).toBe('aula realizada')
    expect(estadoDaAula({ estado: 'rescheduled' }).frase).toContain('remarcada')
    expect(estadoDaAula({ estado: 'no_show_student' }).frase).toBe('você faltou — a aula contou como dada')
    expect(estadoDaAula({ estado: 'no_show_teacher', gerouCredito: true }).frase).toBe(
      'a professora faltou — você ganhou uma reposição',
    )
  })

  it('o cancelamento diz QUEM cancelou e se foi em cima da hora', () => {
    expect(estadoDaAula({ estado: 'cancelled', canceladoPor: 'teacher', gerouCredito: true }).frase).toBe(
      'a professora precisou cancelar — você ganhou uma reposição',
    )
    expect(
      estadoDaAula({ estado: 'cancelled', canceladoPor: 'student', foraDoAviso: false, gerouCredito: false })
        .frase,
    ).toBe('você cancelou — a aula não foi reposta')
    expect(
      estadoDaAula({ estado: 'cancelled', canceladoPor: 'student', foraDoAviso: true, gerouCredito: false })
        .frase,
    ).toBe('você cancelou em cima da hora — a aula não foi reposta')
  })

  it('cancelamento SEM registro nominal não inventa culpado', () => {
    // Encerramento de contrato, troca de horário e pausa cancelam por caminho
    // direto (deliberadamente silenciosos): o banco não sabe quem foi.
    const sem = estadoDaAula({ estado: 'cancelled' })
    expect(sem.frase).toBe('cancelada')
    expect(sem.frase).not.toContain('professora')
    expect(sem.frase).not.toContain('você')
  })

  it('sem registro do desfecho, a frase NÃO promete reposição em nenhuma direção', () => {
    const frase = estadoDaAula({ estado: 'cancelled', canceladoPor: 'teacher' }).frase
    expect(frase).toBe('a professora precisou cancelar')
    expect(frase).not.toContain('reposição')
  })

  it('aula passada ainda sem desfecho registrado tem estado próprio', () => {
    expect(estadoDaAula({ estado: 'scheduled' }).frase).toBe('ainda sem registro')
  })

  it('estado DESCONHECIDO cai numa frase neutra — nunca no código do banco', () => {
    const frase = estadoDaAula({ estado: 'estado_que_ainda_nao_existe' }).frase
    expect(frase).toBe('aula registrada')
    expect(frase).not.toContain('estado_que_ainda_nao_existe')
  })

  it('NENHUMA frase carrega o código do estado nem vocabulário proibido', () => {
    for (const estado of [...ESTADOS_DO_SCHEMA, 'sei_la_o_que']) {
      for (const canceladoPor of [null, 'student', 'teacher']) {
        for (const foraDoAviso of [null, true, false]) {
          for (const gerouCredito of [null, true, false]) {
            const { frase, tom } = estadoDaAula({ estado, canceladoPor, foraDoAviso, gerouCredito })
            expect(frase, estado).not.toContain(estado)
            expect(varrerVocabulario(frase), estado).toEqual([])
            expect(frase.trim(), estado).toMatch(/\S/)
            expect(['ok', 'warn', 'danger', 'neutral', 'muted'], estado).toContain(tom)
          }
        }
      }
    }
  })
})

/* -------------------------------------------------------------------------- */
/* 2. a consequência da ação (D4)                                              */
/* -------------------------------------------------------------------------- */

/** Todo efeito que `preview_reschedule_effect` sabe devolver. */
const EFEITOS_DE_REMARCAR: EfeitoDeRemarcar[] = [
  'franquia',
  'credito',
  'sem_saldo',
  'fora_do_aviso',
  'contrato_inativo',
  'nao_remarcavel',
  'nao_agendada',
]

/** Todo efeito que `preview_cancel_effect` sabe devolver. */
const EFEITOS_DE_CANCELAR: EfeitoDeCancelar[] = [
  'sem_reposicao',
  'ja_comecou',
  'nao_agendada',
  'nao_cancelavel',
]

describe('fraseDeRemarcarAgora — o efeito dito antes do clique', () => {
  it('dentro do aviso e com franquia: sem custo, com o saldo à vista', () => {
    expect(
      fraseDeRemarcarAgora({
        efeito: 'franquia',
        franquiaRestante: 2,
        saldoCreditos: 0,
        minNoticeHours: 24,
        validadeFormatada: null,
      }),
    ).toBe(
      'Remarcando agora: está dentro do prazo de aviso e não custa reposição — você ainda tem 2 remarcações neste mês.',
    )
  })

  it('franquia esgotada: diz que sai UMA reposição, e qual', () => {
    const frase = fraseDeRemarcarAgora({
      efeito: 'credito',
      franquiaRestante: 0,
      saldoCreditos: 3,
      minNoticeHours: 24,
      validadeFormatada: '12/09/2026',
    })
    expect(frase).toContain('sai 1 das suas 3 aulas de reposição')
    expect(frase).toContain('12/09/2026')
  })

  it('sem franquia e sem reposição: a recusa vem antes de escolher horário', () => {
    const frase = fraseDeRemarcarAgora({
      efeito: 'sem_saldo',
      franquiaRestante: 0,
      saldoCreditos: 0,
      minNoticeHours: 24,
      validadeFormatada: null,
    })
    expect(frase).toContain('não dá')
    expect(podeRemarcar({ efeito: 'sem_saldo' })).toBe(false)
  })

  it('o singular existe (nada de "1 remarcações")', () => {
    expect(
      fraseDeRemarcarAgora({
        efeito: 'franquia',
        franquiaRestante: 1,
        saldoCreditos: 0,
        minNoticeHours: 24,
        validadeFormatada: null,
      }),
    ).toContain('1 remarcação neste mês')
    expect(
      fraseDeRemarcarAgora({
        efeito: 'credito',
        franquiaRestante: 0,
        saldoCreditos: 1,
        minNoticeHours: 1,
        validadeFormatada: null,
      }),
    ).toContain('1 aula de reposição')
    expect(
      fraseDeRemarcarAgora({
        efeito: 'fora_do_aviso',
        franquiaRestante: 0,
        saldoCreditos: 0,
        minNoticeHours: 1,
        validadeFormatada: null,
      }),
    ).toContain('menos de 1 hora')
  })

  it('todo efeito tem frase, e só os dois que funcionam viram AÇÃO', () => {
    for (const efeito of EFEITOS_DE_REMARCAR) {
      const frase = fraseDeRemarcarAgora({
        efeito,
        franquiaRestante: 0,
        saldoCreditos: 0,
        minNoticeHours: 24,
        validadeFormatada: null,
      })
      expect(frase, efeito).toMatch(/^[A-ZÀ-Þ][\s\S]*\.$/)
      expect(frase, efeito).not.toContain(efeito)
      expect(varrerVocabulario(frase), efeito).toEqual([])
    }
    expect(EFEITOS_DE_REMARCAR.filter((efeito) => podeRemarcar({ efeito }))).toEqual([
      'franquia',
      'credito',
    ])
  })
})

describe('fraseDeCancelarAgora — a consequência exata (matriz D2)', () => {
  it('dentro do aviso: sem reposição, com o caminho de remarcar ao lado', () => {
    const frase = fraseDeCancelarAgora({
      efeito: 'sem_reposicao',
      geraCredito: false,
      minNoticeHours: 24,
      dentroDoAviso: true,
    })
    expect(frase).toContain('não é reposta')
    expect(frase).toContain('remarcar mantém a sua aula')
  })

  it('em cima da hora: a aula é dada como usada', () => {
    const frase = fraseDeCancelarAgora({
      efeito: 'sem_reposicao',
      geraCredito: false,
      minNoticeHours: 24,
      dentroDoAviso: false,
    })
    expect(frase).toContain('menos de 24 horas')
    expect(frase).toContain('dada como usada')
  })

  it('se a matriz voltar a creditar, a frase acompanha (a régua é do banco)', () => {
    // O dia em que `_cancel_class_core` creditar cancelamento do aluno, o preview
    // devolve gera_credito=true e a tela NÃO pode continuar dizendo "não é
    // reposta". É por isso que a frase lê o campo em vez de saber a regra.
    const frase = fraseDeCancelarAgora({
      efeito: 'sem_reposicao',
      geraCredito: true,
      minNoticeHours: 24,
      dentroDoAviso: true,
    })
    expect(frase).toContain('vira uma reposição')
    expect(frase).not.toContain('não é reposta')
  })

  it('todo efeito tem frase, e só o que funciona vira AÇÃO', () => {
    for (const efeito of EFEITOS_DE_CANCELAR) {
      const frase = fraseDeCancelarAgora({
        efeito,
        geraCredito: false,
        minNoticeHours: 24,
        dentroDoAviso: true,
      })
      expect(frase, efeito).toMatch(/^[A-ZÀ-Þ][\s\S]*\.$/)
      expect(frase, efeito).not.toContain(efeito)
      expect(varrerVocabulario(frase), efeito).toEqual([])
    }
    expect(EFEITOS_DE_CANCELAR.filter((efeito) => podeCancelar({ efeito }))).toEqual(['sem_reposicao'])
  })
})

/* -------------------------------------------------------------------------- */
/* 3. o varredor das quatro telas                                              */
/* -------------------------------------------------------------------------- */

/** Fonte sem comentário: o que sobra é o que pode chegar aos olhos do aluno. */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const raiz = path.resolve(__dirname, '..')
const TELA_AULAS = 'src/app/portal/aulas/page.tsx'
const TELA_AULA = 'src/app/portal/aula/[instance]/page.tsx'
const TELA_REMARCAR = 'src/app/portal/remarcar/[instance]/page.tsx'
const TELA_CANCELAR = 'src/app/portal/cancelar/[instance]/page.tsx'
const TELAS_DO_P4 = [TELA_AULAS, TELA_AULA, TELA_REMARCAR, TELA_CANCELAR]
const fonteDe = (arquivo: string) => readFileSync(path.join(raiz, arquivo), 'utf8')

describe('vocabulário das telas de aula (P4)', () => {
  for (const tela of [...TELAS_DO_P4, 'src/lib/portal/aulas.ts']) {
    const fonte = semComentarios(fonteDe(tela))
    for (const [oQue, regex] of PROIBIDO) {
      it(`${tela} não mostra ${oQue}`, () => {
        expect(regex.test(fonte), `${tela} contém ${regex}`).toBe(false)
      })
    }
  }

  // C3 do P3, estendido às telas novas: a virada do dia e o prazo de aviso são
  // decisões do NEGÓCIO e vivem no Postgres. `Date.now()` segue permitido na
  // página da aula porque é aritmética de época para o botão de entrar — nunca
  // data civil, nunca régua de remarcação.
  it('nenhuma tela de aula decide o dia civil nem o prazo de aviso por conta própria', () => {
    for (const tela of TELAS_DO_P4) {
      const fonte = semComentarios(fonteDe(tela))
      expect(fonte, tela).not.toMatch(/DateTime\.now\(\)/)
      expect(fonte, tela).not.toMatch(/toISODate\(\)/)
      // `diffNow` era como a página velha de remarcar/cancelar media o aviso
      // mínimo — a régua que agora vem de `preview_reschedule_effect`.
      expect(fonte, tela).not.toMatch(/diffNow\(/)
      expect(fonte, tela).not.toMatch(/min_notice_hours/)
    }
  })

  it('a consequência de cada ação sai da MESMA função em todas as telas', () => {
    // D4: a frase que o aluno lê na página da aula, na remarcação e no
    // cancelamento é a mesma — porque é a mesma função, alimentada pelo mesmo
    // preview do banco.
    for (const tela of [TELA_AULA, TELA_REMARCAR]) {
      expect(semComentarios(fonteDe(tela)), tela).toContain('fraseDeRemarcarAgora')
    }
    for (const tela of [TELA_AULA, TELA_CANCELAR]) {
      expect(semComentarios(fonteDe(tela)), tela).toContain('fraseDeCancelarAgora')
    }
  })
})

/* -------------------------------------------------------------------------- */
/* 4. o fim do `?msg=` nestas telas — e o recado que ficou no lugar dele        */
/* -------------------------------------------------------------------------- */

describe('a ponte de nonce morreu nas telas de aula (ADR-025)', () => {
  it('nenhuma das quatro lê `msg`/`n` da URL', () => {
    for (const tela of TELAS_DO_P4) {
      const fonte = semComentarios(fonteDe(tela))
      expect(fonte, tela).not.toMatch(/\bmsg\?:/)
      expect(fonte, tela).not.toMatch(/searchParams.*\bn\?:/)
      // O nonce da ponte velha não volta por distração: recado novo é cookie.
      expect(fonte, tela).not.toMatch(/\?msg=/)
    }
  })

  /* A FRONTEIRA NOVA (revisão do P4 · E6) ------------------------------------
   *
   * A rodada anterior fazia a action DEVOLVER `ResultadoDaAcao` e o
   * `BotaoDeAcao` transformava o retorno em toast. Com JavaScript, funcionava.
   * SEM ele, o React descarta o valor de retorno de uma Server Action: o POST
   * acontecia, a página voltava redesenhada e a RECUSA não aparecia em canto
   * nenhum — quem tentava cancelar via a tela piscar e a aula continuar lá.
   *
   * Agora há um caminho só, que serve aos dois mundos: cookie de uso único +
   * redirect. Estes testes prendem as três pontas dele. */
  it('as três ações novas terminam em cookie + redirect (nunca devolvendo o recado)', () => {
    const acoes = fonteDe('src/app/portal/actions.ts')
    for (const acao of [
      'remarcarAulaAction',
      'cancelarMinhaAulaAction',
      'confirmarMinhaPresencaAction',
    ]) {
      // A assinatura NÃO devolve mais recado: quem sempre termina em redirect é
      // `Promise<void>`. Um `Promise<Resultado…>` aqui é a regressão a pegar.
      expect(acoes, acao).toMatch(
        new RegExp(`export async function ${acao}\\([^)]*\\): Promise<void>`),
      )
    }
    // …e o recado atravessa pelo helper de flash, nunca pela URL.
    expect(acoes).toContain('async function comFlash')
    // A lista de nomes importados cresceu na rodada de correção do P5
    // (`limparFlash`, para o sucesso apagar o recado velho da etapa anterior);
    // o que este teste prende é a PORTA, não a lista.
    expect(acoes).toMatch(/import \{[^}]*gravarFlash[^}]*\} from '@\/lib\/portal\/flash'/)
    // `bookWindowAction` (o resgate de reposição) continua existindo — o que
    // mudou no P5 é que ela também termina em cookie + redirect, e não mais em
    // `?msg=`. A prova de que NADA no portal produz `?msg=` mora em
    // `tests/portal-p5.test.ts`.
    expect(acoes).toContain('export async function bookWindowAction')
  })

  /* E1 — o recado conta a VIA que o banco registrou.
   *
   * A prova de que a via troca (casal em duas abas) é de integração e mora em
   * `tests/portal-p4-efeito.test.ts`. O que se prende AQUI é o outro elo: que a
   * action lê essa via do banco e que cada valor cai na frase certa. Com os dois
   * testes, a corrente fecha — preview consultivo, desfecho contado. */
  it('o recado da remarcação conta a via que o banco registrou', () => {
    const acoes = fonteDe('src/app/portal/actions.ts')
    expect(acoes).toContain('via_da_remarcacao')
    expect(acoes).toMatch(/via === 'allowance'[\s\S]{0,120}dentro da franquia do mês/)
    expect(acoes).toMatch(/via === 'makeup_credit'[\s\S]{0,120}usamos 1 crédito de reposição/)
  })

  it('o recado subiu para a MOLDURA — nenhuma das quatro telas o lê sozinha', () => {
    // 2ª revisão do P4: cada tela lendo o cookie deixava um buraco
    // determinístico — quem ainda não passou pelo gate (ciência/briefing) é
    // redirecionado para uma tela que não lia recado nenhum, e o desfecho da
    // remarcação sumia depois de o crédito ter sido gasto. Agora quem lê é o
    // layout do portal, e estas quatro telas não têm mais nada a ver com isso.
    // O mecanismo inteiro está em `tests/portal-flash.test.ts`.
    for (const tela of TELAS_DO_P4) {
      const fonte = semComentarios(fonteDe(tela))
      expect(fonte, tela).not.toContain('lerFlash')
      expect(fonte, tela).not.toContain('AvisoLegado')
    }
    const layout = semComentarios(fonteDe('src/app/portal/layout.tsx'))
    expect(layout).toContain('<RecadoDoPortal />')
    // O componente da moldura é o MESMO `AvisoLegado` do kit, de propósito: ele
    // já resolve as duas metades — toast com JavaScript, faixa `<noscript>` sem
    // ele. O que mudou é a FONTE do recado (cookie httpOnly, não a URL forjável)
    // e o LUGAR onde ele é lido.
    const moldura = semComentarios(fonteDe('src/components/portal/RecadoDoPortal.tsx'))
    expect(moldura).toContain('lerFlash')
    expect(moldura).toContain('AvisoLegado')
  })

  it('o BotaoDeAcao não depende mais do retorno da ação', () => {
    const botao = semComentarios(fonteDe('src/components/portal/BotaoDeAcao.tsx'))
    // O elenco de tipo existia só para enganar o compilador no caminho sem JS.
    expect(botao).not.toContain('as unknown as')
    // Sem interceptação de submit não há retorno a ler, nem toast a disparar
    // aqui, nem navegação imperativa a instrumentar.
    expect(botao).not.toContain('onSubmit')
    expect(botao).not.toContain('useRouter')
    expect(botao).not.toContain('preventDefault')
    expect(botao).toContain('useFormStatus')
  })
})

/* -------------------------------------------------------------------------- */
/* 5. a resposta tem prazo (E2)                                                */
/* -------------------------------------------------------------------------- */

describe('limiteApertado — quando a tela conta o prazo da resposta', () => {
  const AGORA = Date.parse('2026-07-28T12:00:00Z')

  it('fronteira DENTRO da última hora vira aviso', () => {
    expect(limiteApertado('2026-07-28T12:30:00Z', AGORA)).toBe(true)
    expect(limiteApertado('2026-07-28T12:00:01Z', AGORA)).toBe(true)
    expect(limiteApertado('2026-07-28T13:00:00Z', AGORA)).toBe(true)
  })

  it('fronteira longe não vira aviso — contar 20 horas é ruído', () => {
    expect(limiteApertado('2026-07-29T08:00:00Z', AGORA)).toBe(false)
    expect(limiteApertado('2026-07-28T13:00:01Z', AGORA)).toBe(false)
  })

  it('fronteira JÁ VENCIDA não vira aviso — o preview já classificou pelo outro lado', () => {
    expect(limiteApertado('2026-07-28T12:00:00Z', AGORA)).toBe(false)
    expect(limiteApertado('2026-07-28T11:00:00Z', AGORA)).toBe(false)
  })

  it('sem fronteira (leitura antiga, campo ausente) a tela simplesmente não fala nisso', () => {
    expect(limiteApertado(null, AGORA)).toBe(false)
    expect(limiteApertado(undefined, AGORA)).toBe(false)
    expect(limiteApertado('não é data', AGORA)).toBe(false)
  })

  it('a frase do prazo é de gente e não vaza vocabulário proibido', () => {
    const frase = fraseDoLimite('19:30')
    expect(frase).toContain('19:30')
    expect(frase).toMatch(/^[A-ZÀ-Þ][\s\S]*\.$/)
    expect(varrerVocabulario(frase)).toEqual([])
  })
})
