// M3-c4 — o 2º portão do dono: formulários que não mentem.
//
// Cobre as três frentes com parte PURA:
//  · B1 — a lista de sugestões que não fechava ao escolher (CountryPhoneField e
//    FlexgeLessonPicker recebendo o padrão que o lote 6 · G3 fixou no
//    CityPicker). Sem harness de DOM no repo (o Vitest roda em `node`), o que dá
//    para provar sem teatro é a ESTRUTURA da correção, por leitura de fonte —
//    exatamente como os testes do CityPicker fazem;
//  · B3 — a frase do erro inline (função pura) e a estrutura do `FormValidado`;
//  · B5 — a agenda já ocupada da professora (aritmética pura de minutos, com a
//    conversão de fuso feita no servidor, fora daqui).
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { mensagemDoCampo } from '@/lib/kit/validacao'
import {
  conflitoDe,
  hhmmDeMinutos,
  janelasDoDia,
  minutosDeHhmm,
  pedacosDaAula,
  type JanelaOcupada,
} from '@/lib/agenda/ocupacao'

const RAIZ = path.resolve(__dirname, '..')
const corpo = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8')
/** Código SEM comentários: comentário conta o que MORREU; o que vale é o código. */
const codigo = (rel: string) =>
  corpo(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

/* ========================================================================== */
/* B3 — a frase do erro (pura)                                                 */
/* ========================================================================== */

describe('mensagemDoCampo — o que o campo diz quando trava o envio', () => {
  const base = {
    faltando: false,
    tipoErrado: false,
    formatoErrado: false,
    foraDaFaixa: false,
    frasePropria: null,
    exigencia: null,
    formato: null,
    tipo: 'text',
  }

  it('campo obrigatório vazio fala o NOME do dado (o tom do Design.md)', () => {
    expect(
      mensagemDoCampo({ ...base, faltando: true, exigencia: 'Informe o valor da aula' }),
    ).toBe('Informe o valor da aula')
    expect(
      mensagemDoCampo({ ...base, faltando: true, exigencia: 'Informe o nome completo' }),
    ).toBe('Informe o nome completo')
  })

  it('sem exigência escrita, a frase é nossa — nunca a do navegador', () => {
    const m = mensagemDoCampo({ ...base, faltando: true })
    expect(m).toBe('Este campo é obrigatório.')
    // a frase do balão que o dono reprovou não volta por porta nenhuma
    expect(m).not.toContain('Preencha este campo')
  })

  it('exigência em branco não vira frase vazia (cai no genérico)', () => {
    expect(mensagemDoCampo({ ...base, faltando: true, exigencia: '   ' })).toBe(
      'Este campo é obrigatório.',
    )
  })

  it('a frase PRÓPRIA do campo vence tudo — é ela que sabe o motivo real', () => {
    // CityPicker, DateField (validade mínima) e o conflito de horário do wizard
    // falam por `setCustomValidity`; nada aqui pode calá-los.
    expect(
      mensagemDoCampo({
        ...base,
        faltando: true,
        exigencia: 'Informe a cidade do aluno',
        frasePropria: 'Escolha uma cidade da lista.',
      }),
    ).toBe('Escolha uma cidade da lista.')
    expect(
      mensagemDoCampo({
        ...base,
        frasePropria: 'A professora já tem aula neste horário: 09:00–09:45 · Ana.',
      }),
    ).toBe('A professora já tem aula neste horário: 09:00–09:45 · Ana.')
  })

  it('e-mail torto tem frase de e-mail; formato torto usa o formato do campo', () => {
    expect(mensagemDoCampo({ ...base, tipoErrado: true, tipo: 'email' })).toContain('@')
    expect(mensagemDoCampo({ ...base, formatoErrado: true, formato: 'dd/mm/aaaa' })).toBe(
      'Use o formato dd/mm/aaaa.',
    )
    expect(mensagemDoCampo({ ...base, formatoErrado: true, formato: 'HH:mm' })).toBe(
      'Use o formato HH:mm.',
    )
  })

  it('faixa e caso desconhecido continuam falando português', () => {
    expect(mensagemDoCampo({ ...base, foraDaFaixa: true })).toContain('fora do que este campo aceita')
    expect(mensagemDoCampo(base)).toBe('Confira este campo.')
    expect(mensagemDoCampo({ ...base, exigencia: 'Informe o motivo' })).toBe('Informe o motivo')
  })
})

describe('FormValidado — a estrutura da antecipação', () => {
  const FONTE = codigo('src/components/kit/form-validado.tsx')

  it('o balão nativo morre (noValidate) e ninguém de fora o reacende', () => {
    expect(FONTE).toContain('noValidate')
    // `noValidate` vem DEPOIS do espalhamento de propriedades: atributo tardio
    // vence, então nenhum chamador religa a validação do navegador sem querer.
    expect(FONTE.indexOf('{...props}')).toBeLessThan(FONTE.indexOf('noValidate'))
  })

  it('a validade é a NATIVA — não existe segunda gramática em TypeScript', () => {
    expect(FONTE).toContain('checkValidity()')
    expect(FONTE).toContain('el.validity.valueMissing')
    expect(FONTE).toContain('mensagemDoCampo')
  })

  it('no envio: acende todos os erros, trava e foca o PRIMEIRO', () => {
    const envio = FONTE.slice(FONTE.indexOf('onSubmit={'), FONTE.indexOf('onBlur={'))
    expect(envio).toContain('e.preventDefault()')
    expect(envio).toMatch(/alvoDoFoco\(invalidos\[0\]\)/)
    expect(envio).toContain('.focus()')
  })

  it('valida no blur SÓ depois do primeiro erro daquele campo (§8)', () => {
    expect(FONTE).toContain('marcados.current.add(el)')
    expect(FONTE).toMatch(/onBlur=\{[\s\S]{0,200}marcados\.current\.has\(alvo\)/)
  })

  it('o erro SOME quando o campo é corrigido, sem esperar o blur', () => {
    // E6 da revisão nº 7: o mesmo tratamento passou a valer para `input` E para
    // `change` (o select escondido do Radix só dispara o segundo), então a
    // limpeza virou uma função com nome — provada nos dois gatilhos.
    expect(FONTE).toMatch(/function corrigiu[\s\S]{0,240}checkValidity\(\)\) apagar\(alvo\)/)
    expect(FONTE).toContain('onInput={(e) => corrigiu(e.target)}')
    expect(FONTE).toContain('onChange={(e) => corrigiu(e.target)}')
  })

  it('NUNCA desabilita o envio (botão morto não explica nada)', () => {
    expect(FONTE).not.toMatch(/disabled=\{/)
    expect(FONTE).not.toContain('setDisabled')
  })

  it('o foco não pousa no <select> escondido do Radix — vai para o gatilho', () => {
    const foco = FONTE.slice(FONTE.indexOf('function alvoDoFoco'), FONTE.indexOf('function acender'))
    expect(foco).toContain('aria-hidden')
    expect(foco).toContain('SLOT_GATILHO')
    expect(FONTE).toContain('const SLOT_GATILHO = \'[data-slot="select-trigger"]\'')
  })

  it('o campo em erro é anunciado (aria-invalid + describedby) e pintado por CSS', () => {
    expect(FONTE).toContain("setAttribute('aria-invalid', 'true')")
    expect(FONTE).toContain("setAttribute('aria-describedby'")
    expect(FONTE).toContain("setAttribute('data-erro', 'sim')")

    // a borda vermelha é REGRA UNLAYERED do globals (utility não venceria)
    const css = corpo('src/app/globals.css').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).toMatch(/\[data-erro='sim'\] \{\s*border-color: var\(--danger-700\);/)
  })

  it('cada Campo já traz o parágrafo do erro escrito e escondido', () => {
    const pecas = codigo('src/components/admin/alunos/ficha/pecas.tsx')
    expect(pecas).toContain('data-slot="campo"')
    expect(pecas).toContain('data-slot="campo-erro"')
    expect(pecas).toContain('data-slot="campo-erro-texto"')
    expect(pecas).toContain('data-exigencia={exigencia ?? \'\'}')
    expect(pecas).toContain('role="alert"')
    expect(pecas).toContain('hidden')
    // a frase é a do plano: 14px na cor de perda
    expect(pecas).toContain('text-sm leading-relaxed text-danger-700')
    // …com o ícone pequeno do TutorBird
    expect(pecas).toContain('TriangleAlert')
  })
})

describe('os formulários das telas novas usam o FormValidado', () => {
  const FORMULARIOS = [
    'src/app/admin/alunos/novo/AdmissionWizard.tsx',
    'src/app/admin/alunos/novo/EtapaDoContrato.tsx',
    'src/components/admin/alunos/ficha/paineis.tsx',
  ]

  it.each(FORMULARIOS)('%s não tem mais `<form>` cru', (rel) => {
    const c = codigo(rel)
    expect(c).not.toMatch(/<form\b/)
    expect(c).toContain('<FormValidado')
  })

  it('todo campo obrigatório das telas novas tem frase em português', () => {
    // Um `required` sem `exigencia` no mesmo `Campo` cairia na frase genérica —
    // o que é honesto, mas não é o tom do Design.md. A varredura é por `Campo`:
    // cada bloco que contém um controle obrigatório precisa da sua frase.
    for (const rel of FORMULARIOS) {
      const c = codigo(rel)
      const blocos = c.split(/<Campo\b/).slice(1)
      for (const bloco of blocos) {
        const corpoDoCampo = bloco.slice(0, bloco.indexOf('</Campo>'))
        const obrigatorio = /\brequired\b/.test(corpoDoCampo)
        if (!obrigatorio) continue
        const cabecalho = corpoDoCampo.slice(0, corpoDoCampo.indexOf('>'))
        expect(cabecalho, `${rel}: ${cabecalho.slice(0, 90)}`).toContain('exigencia')
      }
    }
  })

  it('as frases obrigatórias falam no imperativo da casa', () => {
    const frases = FORMULARIOS.flatMap((rel) =>
      [...codigo(rel).matchAll(/exigencia="([^"]+)"/g)].map((m) => m[1]),
    )
    expect(frases.length).toBeGreaterThan(6)
    for (const f of frases) {
      expect(f, f).toMatch(/^(Informe|Escolha|Digite) /)
      expect(f, f).not.toMatch(/[.!]$/) // frase de campo não leva ponto final
    }
  })
})

/* ========================================================================== */
/* B1 — a lista que não fechava ao escolher                                    */
/* ========================================================================== */

describe('CountryPhoneField — escolher país fecha a lista (estrutura)', () => {
  const FONTE = codigo('src/components/CountryPhoneField.tsx')

  it('escolher fecha, leva o foco ao número e cala o gatilho por um tique', () => {
    const escolher = FONTE.slice(FONTE.indexOf('function choose'), FONTE.indexOf('function onKeyDown'))
    expect(escolher).toContain('escolhaFirmada.current = true')
    expect(escolher).toContain('setOpen(false)')
    expect(escolher).toContain('numeroRef.current?.focus()')
    // a marca é firmada ANTES do foco: o clique reencaminhado chega no mesmo
    // tique, quando o estado do React ainda não existe
    expect(escolher.indexOf('escolhaFirmada.current = true')).toBeLessThan(
      escolher.indexOf('numeroRef.current?.focus()'),
    )
    // …e ela se apaga sozinha na volta seguinte do laço, para não engolir um
    // clique de verdade
    expect(escolher).toMatch(/setTimeout\([\s\S]{0,80}escolhaFirmada\.current = false/)
  })

  it('o gatilho consulta a marca SÍNCRONA antes de reabrir', () => {
    expect(FONTE).toMatch(/if \(escolhaFirmada\.current\) \{\s*escolhaFirmada\.current = false\s*return/)
  })

  it('a corrida blur×click morre no mousedown; a opção não é tab stop', () => {
    expect(FONTE).toContain('onMouseDown={(e) => e.preventDefault()}')
    expect(FONTE).toContain('onClick={() => choose(c)}')
    expect(FONTE).toContain('tabIndex={-1}')
  })

  it('Enter escolhe (sem enviar o formulário), setas navegam e Esc fecha', () => {
    const teclas = FONTE.slice(FONTE.indexOf('function onKeyDown'))
    expect(teclas).toMatch(/Escape[\s\S]*setOpen\(false\)/)
    expect(teclas).toMatch(/'Enter'[\s\S]*e\.preventDefault\(\)[\s\S]*choose\(results\[/)
    expect(teclas).toContain("e.key === 'ArrowDown'")
    expect(teclas).toContain("e.key === 'ArrowUp'")
  })

  it('a lista é combobox de verdade', () => {
    expect(FONTE).toContain('role="combobox"')
    expect(FONTE).toContain('role="listbox"')
    expect(FONTE).toContain('role="option"')
    expect(FONTE).toContain('aria-activedescendant')
  })

  it('o campo expõe `id` — o rótulo passa a apontar o NÚMERO, não o país', () => {
    // A raiz local do defeito: um `<label>` que embrulha este campo rotularia o
    // `<button>` do país (primeiro elemento rotulável), e a ativação do rótulo
    // reabria a lista.
    expect(FONTE).toMatch(/id\?: string/)
    expect(FONTE).toMatch(/id=\{id\}/)
    for (const [rel, quantos] of [
      ['src/app/admin/alunos/novo/AdmissionWizard.tsx', 1],
      ['src/components/admin/alunos/ficha/paineis.tsx', 2],
    ] as const) {
      const c = codigo(rel)
      expect(c.match(/<CountryPhoneField\s+id=/g) ?? [], rel).toHaveLength(quantos)
      // e o Campo que hospeda o telefone usa `para`, nunca rótulo embrulhando
      expect(c, rel).toMatch(/<Campo[\s\S]{0,160}para="whatsapp-[^"]+"/)
    }
  })

  it('o popup do país saiu do vocabulário `data-popup` (que é dos <details>)', () => {
    expect(FONTE).not.toContain('data-popup')
  })
})

describe('FlexgeLessonPicker — mesma correção, mesmo padrão', () => {
  const FONTE = codigo('src/components/FlexgeLessonPicker.tsx')

  it('o catálogo baixa UMA vez, e falha não fica em cache', () => {
    // era `let DATASET: Lesson[] | null` com `if (!DATASET)`: a janela em que a
    // primeira requisição ainda estava no ar não era coberta, e cada tecla
    // disparava um download novo.
    expect(FONTE).not.toContain('let DATASET')
    expect(FONTE).toContain('let CATALOGO: Promise<Lesson[]> | null')
    expect(FONTE).toMatch(/catch\(\(\) => \{\s*CATALOGO = null/)
  })

  it('resposta atrasada não mexe na tela (é o que repovoava a lista)', () => {
    const busca = FONTE.slice(FONTE.indexOf('async function search'), FONTE.indexOf('function choose'))
    expect(busca).toContain('const minha = ++geracao.current')
    expect(busca).toMatch(/if \(minha !== geracao\.current\) return[\s\S]*setResults/)
  })

  it('escolher fecha, invalida a busca no ar e o foco não reabre', () => {
    const escolher = FONTE.slice(FONTE.indexOf('function choose'), FONTE.indexOf('function onKeyDown'))
    expect(escolher).toContain('geracao.current++')
    expect(escolher).toContain('escolhaFirmada.current = true')
    expect(escolher).toContain('setOpen(false)')
    expect(FONTE).toContain('if (escolhaFirmada.current || chosen) return')
    // só DIGITAR desarma a supressão
    expect(FONTE).toMatch(/onChange=\{[\s\S]{0,120}escolhaFirmada\.current = false/)
  })

  it('mousedown segura o foco, Enter escolhe, Esc fecha, opção fora do TAB', () => {
    expect(FONTE).toContain('onMouseDown={(e) => e.preventDefault()}')
    expect(FONTE).toContain('tabIndex={-1}')
    expect(FONTE).toMatch(/'Enter'[\s\S]*e\.preventDefault\(\)[\s\S]*choose\(results\[/)
    expect(FONTE).toMatch(/Escape[\s\S]*setOpen\(false\)/)
    expect(FONTE).toContain('role="listbox"')
  })
})

/* ========================================================================== */
/* B5 — a agenda já ocupada da professora                                      */
/* ========================================================================== */

describe('ocupação da professora (aritmética pura de minutos)', () => {
  const janela = (
    p: Partial<JanelaOcupada> & { inicio: number; fim: number },
  ): JanelaOcupada => ({
    professoraId: 'dona',
    weekday: 1,
    quem: 'Ana',
    texto: `${hhmmDeMinutos(p.inicio)}–${hhmmDeMinutos(p.fim)}`,
    ...p,
  })

  it('lê e escreve HH:mm, e recusa o que não é hora', () => {
    expect(minutosDeHhmm('09:30')).toBe(570)
    expect(minutosDeHhmm('00:00')).toBe(0)
    expect(minutosDeHhmm('23:59')).toBe(1439)
    // campo em branco ou meio digitado NÃO é erro — é ausência
    expect(minutosDeHhmm('')).toBeNull()
    expect(minutosDeHhmm('9:3')).toBeNull()
    expect(minutosDeHhmm(null)).toBeNull()
    expect(minutosDeHhmm('25:00')).toBeNull()
    expect(minutosDeHhmm('10:75')).toBeNull()
    expect(hhmmDeMinutos(570)).toBe('09:30')
    expect(hhmmDeMinutos(0)).toBe('00:00')
    // e a volta pela meia-noite (a aula que atravessa o dia)
    expect(hhmmDeMinutos(1470)).toBe('00:30')
  })

  it('a aula que atravessa a meia-noite ocupa DOIS dias', () => {
    expect(pedacosDaAula(5, 600, 45)).toEqual([{ weekday: 5, inicio: 600, fim: 645 }])
    expect(pedacosDaAula(6, 1410, 60)).toEqual([
      { weekday: 6, inicio: 1410, fim: 1440 },
      { weekday: 0, inicio: 0, fim: 30 },
    ])
  })

  it('sobreposição PARCIAL é conflito — não só o início igual', () => {
    const ocupada = [janela({ inicio: 540, fim: 600 })] // segunda 09:00–10:00
    // começa depois e invade
    expect(conflitoDe(ocupada, 'dona', 1, 570, 45)?.texto).toBe('09:00–10:00')
    // começa antes e invade
    expect(conflitoDe(ocupada, 'dona', 1, 510, 45)?.texto).toBe('09:00–10:00')
    // engloba
    expect(conflitoDe(ocupada, 'dona', 1, 480, 180)).not.toBeNull()
    // encosta sem invadir: 10:00 começa quando a outra termina — cabe
    expect(conflitoDe(ocupada, 'dona', 1, 600, 45)).toBeNull()
    expect(conflitoDe(ocupada, 'dona', 1, 480, 60)).toBeNull()
  })

  it('conflito é por PROFESSORA e por DIA — a agenda de outra não estorva', () => {
    const ocupada = [janela({ inicio: 540, fim: 600 })]
    expect(conflitoDe(ocupada, 'parceira', 1, 540, 45)).toBeNull()
    expect(conflitoDe(ocupada, 'dona', 2, 540, 45)).toBeNull()
    expect(conflitoDe(ocupada, 'dona', 1, 540, 45)).not.toBeNull()
  })

  it('a aula nova que atravessa a meia-noite bate no dia SEGUINTE', () => {
    const ocupada = [janela({ weekday: 0, inicio: 0, fim: 60 })] // domingo 00:00–01:00
    // sábado 23:30 + 60min entra no domingo 00:30
    expect(conflitoDe(ocupada, 'dona', 6, 1410, 60)).not.toBeNull()
    // sábado 22:00 + 60min termina às 23:00 — não chega no domingo
    expect(conflitoDe(ocupada, 'dona', 6, 1320, 60)).toBeNull()
  })

  it('duração zero ou negativa não inventa conflito', () => {
    const ocupada = [janela({ inicio: 540, fim: 600 })]
    expect(conflitoDe(ocupada, 'dona', 1, 550, 0)).toBeNull()
    expect(conflitoDe(ocupada, 'dona', 1, 550, -30)).toBeNull()
  })

  it('a lista do dia sai ordenada, só da professora e do dia escolhidos', () => {
    const todas = [
      janela({ inicio: 600, fim: 645, quem: 'Bia' }),
      janela({ inicio: 480, fim: 525, quem: 'Ana' }),
      janela({ weekday: 3, inicio: 500, fim: 545, quem: 'Caio' }),
      janela({ professoraId: 'parceira', inicio: 490, fim: 535, quem: 'Dora' }),
    ]
    expect(janelasDoDia(todas, 'dona', 1).map((j) => j.quem)).toEqual(['Ana', 'Bia'])
    expect(janelasDoDia(todas, 'dona', 4)).toEqual([])
  })
})

describe('a etapa do contrato antecipa o conflito (estrutura)', () => {
  const FONTE = codigo('src/app/admin/alunos/novo/EtapaDoContrato.tsx')

  it('mostra o que a professora já tem no dia escolhido', () => {
    expect(FONTE).toContain('janelasDoDia(ocupacao, professora, h.weekday)')
    expect(FONTE).toContain('Ela já tem neste dia')
    expect(FONTE).toContain('Ela não tem nada marcado neste dia')
    expect(FONTE).toContain('Escolha a professora acima')
  })

  it('trava a hora em conflito pela validade do campo (o kit mostra a frase)', () => {
    expect(FONTE).toContain('conflitoDe(ocupacao, professora, h.weekday, inicio, h.duracao)')
    expect(FONTE).toContain('A professora já tem aula neste horário')
    // …e os DOIS horários desta mesma tela também não podem se sobrepor
    expect(FONTE).toContain('Os dois horários desta tela se sobrepõem')
    expect(FONTE).toMatch(/problema=\{problemaDe\(i\)\}/)
    const tf = codigo('src/components/TimeField.tsx')
    expect(tf).toContain('setCustomValidity(problema ?? \'\')')
  })

  it('Lei 1: a etapa cliente NÃO faz conta de fuso — ela chega pronta', () => {
    expect(FONTE).not.toMatch(/new Date\(|toLocaleString|DateTime\.|luxon/)
    expect(FONTE).toContain('fusoDoAluno')
    // E a conversão está no servidor, com o offset do dia específico. Ela saiu
    // de `alunos.ts` na revisão nº 7 (E3b) para `@/lib/agenda/ocupacao-fuso` e,
    // no P9 da nº 8, deixou de EXPANDIR o horário fixo em Luxon: converte as
    // aulas que o banco JÁ materializou, que é a única fonte que acerta hora
    // ambígua de DST, o limite do horizonte e a vigência do slot.
    const conversao = codigo('src/lib/agenda/ocupacao-fuso.ts')
    expect(conversao).toContain('export function janelasDoHorarioFixo')
    expect(conversao).toContain('export function janelasDaAgenda')
    expect(conversao).toContain('.setZone(alunoTz)')
    expect(conversao).toContain('SEMANAS_DE_ANTECIPACAO')
  })

  it('a mutação continua sendo a MESMA action, com os mesmos campos', () => {
    expect(FONTE).toContain('action={action}')
    for (const campo of ['teacher_id', 'plan_name', 'hourly_rate', 'allowance', 'started_on']) {
      expect(FONTE, campo).toContain(`name="${campo}"`)
    }
    expect(FONTE).toContain('name={`t${i + 1}`}')
    expect(FONTE).toContain('name={`w${i + 1}`}')
    expect(FONTE).toContain('name={`d${i + 1}`}')
    expect(codigo('src/app/admin/alunos/novo/AdmissionWizard.tsx')).toContain(
      'action={wizardContractAction}',
    )
  })

  it('quando o conflito escapa da antecipação, a action fala em gente', () => {
    const acoes = codigo('src/app/admin/alunos/novo/actions.ts')
    expect(acoes).toContain('function erroDeHorarioEmGente')
    expect(acoes).toContain('a professora já tem aula nesse horário')
    // ATUALIZADO NO M4-4: a chamada era `erroDeHorarioEmGente(slotErr.message)`,
    // o erro de UM horário dentro do laço de `create_slot`. O laço morreu — a
    // admissão cria contrato e horários numa chamada só de
    // `admin_create_contract` —, então o que se traduz agora é o erro da RPC. A
    // intenção não afrouxou: continua sendo "o que o banco recusar chega em
    // português", e passou a valer para a criação INTEIRA, não só para o slot.
    expect(acoes).toContain('erroDeHorarioEmGente(error?.message')
  })

  it('a leitura da ocupação só conta o que a agenda TEM marcado', () => {
    // E3b: a leitura mudou de casa (`ocupacao-consulta.ts`) para poder ser
    // executada contra o banco no Vitest — `alunos.ts` é `server-only`.
    // P9: os filtros de contrato/vigência saíram porque a fonte mudou — o que
    // vale agora é a instância materializada, que já nasce dentro da vigência e
    // some quando a aula é cancelada.
    const dados = codigo('src/data/admin/ocupacao-consulta.ts')
    const leitura = dados.slice(dados.indexOf('export async function lerAulasDaAgenda'))
    expect(leitura).toContain("from('class_instances')")
    expect(leitura).toContain("eq('state', 'scheduled')")
    expect(leitura).toContain("gte('starts_at_utc'")
    expect(leitura).toContain("lte('starts_at_utc'")
  })
})

/* ========================================================================== */
/* B2 — placeholder é sugestão, nunca dado                                     */
/* ========================================================================== */

describe('placeholders das telas novas', () => {
  const TELAS = [
    'src/app/admin/alunos/novo/AdmissionWizard.tsx',
    'src/app/admin/alunos/novo/EtapaDoContrato.tsx',
    'src/components/admin/alunos/ficha/paineis.tsx',
    'src/components/admin/alunos/ficha/pecas.tsx',
    'src/components/admin/alunos/ListaDeAlunos.tsx',
    'src/components/admin/inicio/RegistrarDesfecho.tsx',
    'src/app/admin/alunos/grupo/[eixo]/[valor]/page.tsx',
    'src/components/kit/select.tsx',
  ]

  /** Valor PLAUSÍVEL: número, data, dinheiro, e-mail — o que a pessoa lê como
   *  campo preenchido. Instrução ("Buscar aluno…", "Escolha…") não é valor. */
  const PARECE_VALOR = /^(?:[\d.,:/-]|[\w.+-]+@)/

  it('todo exemplo plausível começa com "ex.:" (a régua nova da casa)', () => {
    const achados: string[] = []
    for (const rel of TELAS) {
      for (const m of codigo(rel).matchAll(/placeholder=(?:"([^"]*)"|\{'([^']*)'\})/g)) {
        const texto = (m[1] ?? m[2] ?? '').trim()
        if (!texto || texto.startsWith('ex.:')) continue
        if (PARECE_VALOR.test(texto)) achados.push(`${rel}: "${texto}"`)
      }
    }
    expect(achados).toEqual([])
  })

  it('os exemplos que o dono viu como dado agora se anunciam como exemplo', () => {
    expect(codigo('src/app/admin/alunos/novo/EtapaDoContrato.tsx')).toContain(
      'placeholder="ex.: 150,00"',
    )
    expect(codigo('src/app/admin/alunos/novo/AdmissionWizard.tsx')).toContain(
      'placeholder="ex.: aluno@exemplo.com"',
    )
    expect(codigo('src/components/admin/alunos/ficha/paineis.tsx')).toContain(
      'placeholder="ex.: aluno@exemplo.com"',
    )
    expect(codigo('src/components/CountryPhoneField.tsx')).toContain("'ex.: (65) 90000-0000'")
  })

  it('placeholder é MAIS CLARO que o dado digitado, em toda peça de campo', () => {
    // A causa da leitura errada: o placeholder saía em `--ink-600` (o cinza do
    // RÓTULO) enquanto o dado sai em `--ink-900`. Perto demais.
    for (const rel of TELAS) {
      const c = codigo(rel)
      expect(c, rel).not.toContain('placeholder:text-ink-600')
      expect(c, rel).not.toContain('data-[placeholder]:text-ink-600')
    }
    expect(codigo('src/components/admin/alunos/ficha/pecas.tsx')).toContain(
      'text-ink-900 placeholder:text-ink-400',
    )
    expect(codigo('src/components/kit/select.tsx')).toContain('data-[placeholder]:text-ink-400')
  })
})
