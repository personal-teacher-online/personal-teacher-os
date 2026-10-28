// INÍCIO + CRÉDITOS DO PORTAL (Onda do Portal · P3) — as três decisões que a
// tela toma sozinha, cobradas fora do navegador:
//
//   1. de onde veio este crédito, em português (D9) — TODOS os motivos do
//      schema, e o motivo que ainda não existe;
//   2. a janela do botão de entrar (D1) — antes, dentro e depois;
//   3. o cartão COM MÉRITO (D2) — quando ele existe e, principalmente, quando
//      NÃO existe (o "venceu em 12/07" sem ação que o dono fotografou);
//
// …mais um varredor que lê as duas telas NA FONTE atrás do vocabulário que a IA
// matou: "lançamento", "−1/+1", "auditado", "ledger" e data em formato de
// máquina. É o mesmo espírito do varredor de frases do `portal-nav.test.ts`:
// quem escrever a palavra proibida numa tela do aluno vê o teste vermelho.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  JANELA_DO_CARTAO_DIAS,
  MOTIVOS_CONHECIDOS,
  fraseDeContagem,
  fraseDeOrigem,
  fraseDeSaldo,
  mostrarCartaoDeCreditos,
} from '@/lib/portal/creditos'
import {
  ABERTURA_ANTES_MS,
  ROTULO_ABERTO,
  estadoDoBotao,
  minutosParaComecar,
  rotuloDoBotao,
} from '@/lib/portal/entrar'
import { mostrarVazioAfirmativo } from '@/lib/portal/vazio'
import { PROIBIDO, varrerVocabulario } from './helpers/vocabulario'

/* -------------------------------------------------------------------------- */
/* 1. motivo → frase de gente                                                 */
/* -------------------------------------------------------------------------- */

const CTX = { em: '12/06/2026', aula: 'sexta, 05/06 às 19:00', nota: null }

describe('fraseDeOrigem — todo motivo do schema vira português', () => {
  it('o caso comum diz QUEM desmarcou e QUAL aula', () => {
    expect(fraseDeOrigem('earn_cancellation', { ...CTX, autor: 'teacher' })).toBe(
      'Você ganhou em 12/06/2026 porque a professora precisou desmarcar a aula de sexta, 05/06 às 19:00.',
    )
    // Sem a aula ligada (crédito antigo, migração), a frase continua inteira.
    expect(fraseDeOrigem('earn_cancellation', { em: '12/06/2026', autor: 'teacher' })).toBe(
      'Você ganhou em 12/06/2026 porque a professora precisou desmarcar uma aula.',
    )
  })

  /* O ACHADO E3 DA REVISÃO DO P4 --------------------------------------------
   *
   * A frase acima era a resposta para TODO `earn_cancellation`. Ela é verdade
   * DEPOIS da ADR-018 (18/07/2026) e só depois: antes dela, cancelamento do
   * ALUNO com aviso também creditava, e esses lançamentos continuam no ledger.
   * Para eles, a tela acusava a escola de uma falha que foi decisão do aluno.
   *
   * Agora quem decide é o autor que o banco leu do audit da aula — e quando não
   * há autor determinável, a frase conta o FATO sem nomear ninguém. */
  it('crédito nascido de cancelamento DO ALUNO não acusa a professora', () => {
    const frase = fraseDeOrigem('earn_cancellation', { ...CTX, autor: 'student' })
    expect(frase).toBe(
      'Você ganhou em 12/06/2026 quando você desmarcou a aula de sexta, 05/06 às 19:00 com antecedência.',
    )
    expect(frase).not.toContain('professora')
    expect(fraseDeOrigem('earn_cancellation', { em: '12/06/2026', autor: 'student' })).toBe(
      'Você ganhou em 12/06/2026 quando você desmarcou uma aula com antecedência.',
    )
  })

  it('SEM autor determinável, a frase é neutra — não inventa culpado', () => {
    for (const ctx of [CTX, { ...CTX, autor: null }]) {
      const frase = fraseDeOrigem('earn_cancellation', ctx)
      expect(frase).toBe('Você ganhou em 12/06/2026 quando a aula de sexta, 05/06 às 19:00 foi desmarcada.')
      expect(frase).not.toContain('professora')
      // "você desmarcou" seria a acusação na outra direção; "Você ganhou" não é.
      expect(frase).not.toContain('você desmarcou')
    }
    expect(fraseDeOrigem('earn_cancellation', { em: '12/06/2026' })).toBe(
      'Você ganhou em 12/06/2026 quando uma aula foi desmarcada.',
    )
  })

  it('saldo trazido, ajuste da escola (com e sem recado) e devolução', () => {
    expect(fraseDeOrigem('initial_backlog', CTX)).toContain('já tinha com a gente')
    expect(fraseDeOrigem('manual_adjust', { em: '12/06/2026' })).toBe(
      'A escola te deu esse crédito em 12/06/2026.',
    )
    expect(fraseDeOrigem('manual_adjust', { em: '12/06/2026', nota: 'cirurgia da Maria' })).toBe(
      'A escola te deu esse crédito em 12/06/2026 — cirurgia da Maria.',
    )
    expect(fraseDeOrigem('refund', CTX)).toContain('voltou para você')
  })

  it('gasto e vencimento também têm frase (nenhum estado fica sem nome)', () => {
    expect(fraseDeOrigem('spend_reschedule', CTX)).toContain('Você usou esse crédito')
    expect(fraseDeOrigem('expire', CTX)).toBe('Esse crédito venceu em 12/06/2026.')
  })

  it('motivo DESCONHECIDO cai numa frase neutra — nunca no código do banco', () => {
    // O dia em que o schema ganhar um motivo novo, o aluno lê português.
    const frase = fraseDeOrigem('motivo_que_ainda_nao_existe', CTX)
    expect(frase).toBe('Crédito registrado em 12/06/2026.')
    expect(frase).not.toContain('motivo_que_ainda_nao_existe')
  })

  it('NENHUMA frase carrega o código do motivo nem vocabulário de contabilidade', () => {
    for (const motivo of [...MOTIVOS_CONHECIDOS, 'sei_la_o_que']) {
      for (const ctx of [
        CTX,
        { em: '12/06/2026' },
        { em: '12/06/2026', nota: 'ajuste combinado' },
        // …e os DOIS ramos de autor (E3): o varredor tem de passar em todos.
        { ...CTX, autor: 'teacher' as const },
        { ...CTX, autor: 'student' as const },
      ]) {
        const frase = fraseDeOrigem(motivo, ctx)
        expect(frase, motivo).not.toContain(motivo)
        // A MESMA lista do varredor de fonte, agora sobre o texto RENDERIZADO
        // (P3 · achado do revisor): a frase que a função devolve é o que o aluno
        // lê, e ela não era varrida por ninguém.
        expect(varrerVocabulario(frase), motivo).toEqual([])
        // Frase de gente termina em ponto e começa com maiúscula.
        expect(frase, motivo).toMatch(/^[A-ZÀ-Þ][\s\S]*\.$/)
      }
    }
  })

  it('as frases de validade e de saldo também passam pelo varredor', () => {
    for (const dias of [90, 48, 1, 0, -1, -5, -60]) {
      expect(varrerVocabulario(fraseDeContagem(dias)), String(dias)).toEqual([])
    }
    for (const n of [1, 2, 7]) {
      expect(varrerVocabulario(fraseDeSaldo(n)), String(n)).toEqual([])
    }
  })
})

/* -------------------------------------------------------------------------- */
/* 2. validade nos dois formatos (D2)                                          */
/* -------------------------------------------------------------------------- */

describe('validade em duas leituras', () => {
  // A CONTA DE DIAS SAIU DAQUI (revisão adversarial do P3): quem decide se um
  // crédito venceu, e quantos dias faltam, é `business_today()` no banco — a
  // mesma régua do makeup_balance e do e-mail 5. O teste que sobrou é o de que
  // nenhuma das duas telas volta a montar um "hoje" próprio: o guarda está lá
  // embaixo, em "nenhuma tela de crédito decide o dia civil".

  it('a contagem se lê em voz alta', () => {
    expect(fraseDeContagem(48)).toBe('faltam 48 dias')
    expect(fraseDeContagem(1)).toBe('falta 1 dia')
    expect(fraseDeContagem(0)).toBe('vence hoje')
    expect(fraseDeContagem(-1)).toBe('venceu ontem')
    expect(fraseDeContagem(-5)).toBe('venceu há 5 dias')
  })

  it('saldo em palavras, nunca "1 crédito(s)"', () => {
    expect(fraseDeSaldo(1)).toBe('1 reposição')
    expect(fraseDeSaldo(3)).toBe('3 reposições')
  })
})

/* -------------------------------------------------------------------------- */
/* 3. o cartão COM MÉRITO                                                      */
/* -------------------------------------------------------------------------- */

describe('mostrarCartaoDeCreditos — cartão sem ação não nasce', () => {
  it('com saldo, aparece (com ou sem vencimento à vista)', () => {
    expect(mostrarCartaoDeCreditos({ saldo: 1, dias: 48 })).toBe(true)
    expect(mostrarCartaoDeCreditos({ saldo: 2, dias: null })).toBe(true)
  })

  it('sem saldo e sem vencimento próximo, NÃO EXISTE', () => {
    expect(mostrarCartaoDeCreditos({ saldo: 0, dias: null })).toBe(false)
    expect(mostrarCartaoDeCreditos({ saldo: 0, dias: JANELA_DO_CARTAO_DIAS + 1 })).toBe(false)
  })

  it('vencimento JÁ PASSADO não acende o cartão (a foto do dono)', () => {
    // "venceu em 12/07/2026" num cartão sem próximo passo é exatamente o que a
    // IA matou: má notícia sem ação. Quem conta essa história é a tela de
    // créditos, que explica o que aconteceu.
    expect(mostrarCartaoDeCreditos({ saldo: 0, dias: -1 })).toBe(false)
    expect(mostrarCartaoDeCreditos({ saldo: 0, dias: -30 })).toBe(false)
  })

  it('dentro da janela de 30 dias, aparece mesmo sem saldo somado', () => {
    expect(mostrarCartaoDeCreditos({ saldo: 0, dias: 0 })).toBe(true)
    expect(mostrarCartaoDeCreditos({ saldo: 0, dias: JANELA_DO_CARTAO_DIAS })).toBe(true)
  })
})

/* -------------------------------------------------------------------------- */
/* 4. a janela do botão Entrar (D1)                                            */
/* -------------------------------------------------------------------------- */

describe('estadoDoBotao — antes, dentro e depois', () => {
  const inicio = 1_800_000_000_000
  const fim = inicio + 45 * 60_000

  it('longe do começo: desligado', () => {
    expect(estadoDoBotao(inicio - 60 * 60_000, inicio, fim)).toBe('cedo')
    // Um milissegundo antes da abertura ainda é "cedo" — a fronteira é fechada
    // do lado do aluno, não do nosso.
    expect(estadoDoBotao(inicio - ABERTURA_ANTES_MS - 1, inicio, fim)).toBe('cedo')
  })

  it('15 minutos antes acende, e continua aceso DEPOIS do horário de começo', () => {
    expect(estadoDoBotao(inicio - ABERTURA_ANTES_MS, inicio, fim)).toBe('aberto')
    expect(estadoDoBotao(inicio, inicio, fim)).toBe('aberto')
    // Quem chega 10 minutos atrasado precisa do MESMO botão.
    expect(estadoDoBotao(inicio + 10 * 60_000, inicio, fim)).toBe('aberto')
    expect(estadoDoBotao(fim - 1, inicio, fim)).toBe('aberto')
  })

  it('no fim da aula o botão deixa de existir', () => {
    expect(estadoDoBotao(fim, inicio, fim)).toBe('encerrado')
    expect(estadoDoBotao(fim + 3_600_000, inicio, fim)).toBe('encerrado')
  })

  it('o rótulo conta os minutos até 60 e vira hora marcada acima disso', () => {
    const rotulo = (agora: number) =>
      rotuloDoBotao(estadoDoBotao(agora, inicio, fim), minutosParaComecar(agora, inicio), '20:00')

    // A contagem só existe ANTES da abertura (15 min): de 12 minutos o botão já
    // está aceso — o "[ Entrar em 12 min ]" do mockup da IA é ilustração, e a
    // régua normativa é a do P3 (abre 15 min antes).
    expect(rotulo(inicio - 20 * 60_000)).toBe('Entrar em 20 min')
    // 19min40s ainda são "20 min": arredondar para baixo atrasaria o aluno.
    expect(rotulo(inicio - (19 * 60_000 + 40_000))).toBe('Entrar em 20 min')
    expect(rotulo(inicio - 16 * 60_000)).toBe('Entrar em 16 min')
    expect(rotulo(inicio - 60 * 60_000)).toBe('Entrar em 60 min')
    // Acima de 60 min o texto vira a HORA — e essa string vem pronta do
    // servidor, formatada na zona do aluno (Lei 1).
    expect(rotulo(inicio - 61 * 60_000)).toBe('Entrar às 20:00')
    expect(rotulo(inicio - 5 * 3_600_000)).toBe('Entrar às 20:00')
    expect(rotulo(inicio - 12 * 60_000)).toBe(ROTULO_ABERTO)
    expect(rotulo(inicio - 60_000)).toBe(ROTULO_ABERTO)
  })
})

/* -------------------------------------------------------------------------- */
/* 5. o varredor: o que estas telas NÃO podem dizer                            */
/* -------------------------------------------------------------------------- */

/** Fonte sem comentário: o que sobra é o que pode chegar aos olhos do aluno. */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const raiz = path.resolve(__dirname, '..')
const TELA_CREDITOS = 'src/app/portal/creditos/page.tsx'
const TELA_INICIO = 'src/app/portal/page.tsx'
const TELA_PAGAMENTOS = 'src/app/portal/pagamentos/page.tsx'
// P5: as telas reformadas no milestone entram no MESMO varredor. O resgate é a
// que mais precisava dele — é uma tela de gasto de crédito, exatamente a
// família onde o jargão de ledger e a data de máquina vazam.
const TELA_RESGATAR = 'src/app/portal/resgatar/[contract]/page.tsx'
const TELA_PERFIL = 'src/app/portal/perfil/page.tsx'
const TELA_MENTORIA = 'src/app/portal/mentoria/page.tsx'
const TELA_CIENCIA = 'src/app/portal/ciencia/page.tsx'
const fonteDe = (arquivo: string) => readFileSync(path.join(raiz, arquivo), 'utf8')

describe('vocabulário das telas do aluno (P3)', () => {
  const telas = [
    TELA_CREDITOS,
    TELA_INICIO,
    'src/lib/portal/creditos.ts',
    // P5
    TELA_PAGAMENTOS,
    TELA_RESGATAR,
    TELA_PERFIL,
    TELA_MENTORIA,
    TELA_CIENCIA,
    'src/lib/portal/pagamentos.ts',
    // Rodada de correção: a escada da mentoria virou módulo puro, e as palavras
    // dos degraus ("usada", "janela aberta") são texto de tela — entram junto.
    'src/lib/portal/mentoria.ts',
  ]

  for (const tela of telas) {
    const fonte = semComentarios(fonteDe(tela))
    for (const [oQue, regex] of PROIBIDO) {
      it(`${tela} não mostra ${oQue}`, () => {
        expect(regex.test(fonte), `${tela} contém ${regex}`).toBe(false)
      })
    }
  }

  it('a tela de créditos ENSINA a regra (ADR-018 em língua de aluno)', () => {
    const fonte = fonteDe(TELA_CREDITOS)
    // como se ganha · como se perde · o que acontece no vencimento · o aviso
    //
    // A5/L5 (Sol · rodada 1 do A5, grave): este caso PINAVA a frase falsa. Ele
    // cobrava "Você ganha um crédito quando a escola precisa desmarcar", e essa
    // frase universaliza uma regra que o banco não tem — crédito também nasce de
    // FALTA DA PROFESSORA e de AJUSTE MANUAL, e a aula perdida que já era uma
    // reposição antiga (`consumes_ledger_id is null`) NÃO é recreditada
    // automaticamente. Teste que pina mentira é dívida, não contrato: agora ele
    // cobra as ORIGENS no plural e a EXCEÇÃO declarada.
    // Rodada 2: as origens de HOJE são TRÊS (a terceira é o ajuste manual), e a
    // tela passou a separar isso do que pode APARECER no extrato (saldo trazido,
    // devolução, histórico anterior à ADR-018).
    expect(fonte).toContain('quando a professora falta, ou')
    expect(fonte).toContain('quando a gente lança um ajuste para você')
    expect(fonte).toMatch(/No seu extrato também podem aparecer/)
    expect(fonte).toMatch(/casos raros[\s\S]{0,160}não volta sozinho/)
    expect(fonte).toContain('Cancelar de vez não vira crédito')
    expect(fonte).toContain('depois disso ele não vira mais aula')
  })

  // C10 da revisão adversarial: o texto anterior era "a gente te avisa 30 e 15
  // dias antes de vencer, por e-mail e no WhatsApp". O `enqueue-credit-expiry-
  // daily` não promete isso: ele avisa quando o crédito ENTRA na janela de 30 e
  // de 15 dias (um crédito nascido faltando 10 dias recebe UM aviso, nunca aos
  // 30), o WhatsApp só sai para quem deixou o número, e contrato pausado não
  // recebe nada. Prometer o dia exato é prometer precisão que não existe.
  it('a promessa de aviso não é mais precisa que o job que a cumpre', () => {
    const fonte = semComentarios(fonteDe(TELA_CREDITOS))
    expect(fonte).toContain('chegando perto de vencer')
    expect(fonte).not.toMatch(/30 e 15 dias/)
    // "no WhatsApp" sem condição prometeria canal a quem não deu o número.
    expect(fonte).toMatch(/se a gente tiver o seu número/)
  })

  // C8: o rótulo tem de prometer o que a rota faz. `/portal/resgatar` MARCA UMA
  // AULA EXTRA — "usar meu crédito" soava como aproveitar o crédito na aula da
  // semana, que é outra rota (remarcar).
  it('o botão de crédito diz que agenda uma aula EXTRA — nos dois lugares', () => {
    for (const tela of [TELA_CREDITOS, TELA_INICIO]) {
      const fonte = semComentarios(fonteDe(tela))
      expect(fonte, tela).toContain('Agendar reposição')
      expect(fonte, tela).toContain('Isso cria uma aula extra')
      expect(fonte, tela).toMatch(/use Remarcar na própria aula/)
      expect(fonte, tela).not.toMatch(/Usar (este crédito|meu crédito)/)
    }
  })

  // C3: a virada do dia que decide crédito é a do NEGÓCIO, e ela vive no
  // Postgres. Nenhuma das três telas pode voltar a montar um "hoje" próprio —
  // `Date.now()` do Início segue permitido porque é aritmética de época para o
  // botão de entrar (nunca data civil).
  //
  // PAGAMENTOS entrou na lista na revisão 2 (D3): ela montava
  // `DateTime.now().toFormat('yyyy-LL-dd')` para decidir a pill "vencida",
  // enquanto o atraso do dinheiro é decidido por `business_today()` dentro da
  // view. Era a MESMA classe de defeito, numa tela que o guarda não olhava.
  //
  // RESGATAR entrou na lista no P5: ela montava
  // `new Date().toISOString().slice(0, 10)` para escolher o crédito da vez —
  // o "hoje" em UTC decidindo vencimento de dinheiro. A escolha agora é do
  // banco (`student_credit_statement`, com `business_today()`).
  it('nenhuma tela de crédito ou dinheiro decide o dia civil (a régua é business_today)', () => {
    for (const tela of [TELA_CREDITOS, TELA_INICIO, TELA_PAGAMENTOS, TELA_RESGATAR]) {
      const fonte = semComentarios(fonteDe(tela))
      expect(fonte, tela).not.toMatch(/DateTime\.now\(\)/)
      expect(fonte, tela).not.toMatch(/toISODate\(\)/)
      // A terceira forma de fabricar um "hoje" — a que o resgate usava.
      expect(fonte, tela).not.toMatch(/toISOString\(\)\s*\.?\s*slice/)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* 6. vazio afirmativo × leitura que falhou                                    */
/* -------------------------------------------------------------------------- */

describe('mostrarVazioAfirmativo — "não há nada" exige ter olhado', () => {
  it('leitura OK e lista vazia: a frase aparece', () => {
    expect(mostrarVazioAfirmativo({ erro: false, itens: 0 })).toBe(true)
  })

  it('leitura FALHOU: a frase não aparece, mesmo com a lista vazia', () => {
    // O caso do achado: aviso de falha e, logo abaixo, "Nenhuma aula agendada"
    // — a afirmação grande ganha do aviso pequeno toda vez.
    expect(mostrarVazioAfirmativo({ erro: true, itens: 0 })).toBe(false)
  })

  it('com itens na lista não há vazio a afirmar', () => {
    expect(mostrarVazioAfirmativo({ erro: false, itens: 3 })).toBe(false)
    expect(mostrarVazioAfirmativo({ erro: true, itens: 3 })).toBe(false)
  })
})
