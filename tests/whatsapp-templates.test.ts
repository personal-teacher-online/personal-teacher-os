// CLOUD API · #41 — o catálogo dos templates de WhatsApp (ADR-038, opção B).
//
// Teste PURO, sem banco. O que ele prende, na ordem do risco:
//
//   1. COBERTURA: toda chave que o despachante sabe mandar por WhatsApp
//      (`spec.text` em `src/lib/outbox/dispatch.ts`) tem template na Meta ou
//      está na lista nominal das três "sem template na Meta" — e nada sobra do
//      outro lado (template sem chave no despachante);
//   2. AS REGRAS DA META que fazem o template voltar recusado: parâmetro vazio
//      ou com quebra de linha, corpo acima de 1024 caracteres, nome fora de
//      `[a-z0-9_]`, `{{n}}` fora de ordem ou repetido, categoria e idioma;
//   3. O TEXTO: o corpo de cada template é o bloco WhatsApp do documento de
//      revisão da dona (M3-4), que `scripts/textos-revisao.ts` gera do código —
//      "nenhuma palavra inventada";
//   4. O JSON versionado (`docs/whatsapp-templates.json`) é a saída do
//      gerador: mudar texto sem regenerar fica vermelho;
//   5. a mentoria liberada não tem palavra que a Meta lê como marketing;
//   6. a variante "a escola moveu" existe e não é a de "você remarcou".

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { DateTime, Settings } from 'luxon'
import { describe, expect, it, vi } from 'vitest'
import { avisarSemLista, nomesNoTexto, semAcento, termosProibidos } from './helpers/nomes-proibidos'

// O rodapé "fale com a gente" só existe com o número de atendimento na config:
// número fictício fixado ANTES dos imports (o link é lido na carga do módulo).
vi.hoisted(() => {
  process.env.WHATSAPP_ATENDIMENTO_E164 = '+5565900000001'
})

import { TEMPLATES } from '@/lib/outbox/dispatch'
import { textoDoHtml } from '@/data/admin/ajustes-mensagens'
import { classCancelledEmail, classReminderEmail, prazoDoToqueDe48h } from '@/lib/email/class-notices'
import { creditExpiryEmail } from '@/lib/email/credit-expiry'
import { teacherMovedEmail } from '@/lib/email/reschedule'
import {
  CATEGORIA_DOS_TEMPLATES,
  CHAVES_SEM_TEMPLATE_NA_META,
  IDIOMA_DOS_TEMPLATES,
  MAXIMO_DE_BOTOES_DE_URL,
  MAXIMO_DO_TEXTO_DO_BOTAO,
  TEMPLATES_DE_WHATSAPP,
  botoesEmOrdem,
  exemplosDoTemplate,
  jsonDeSubmissao,
  nomeDaProfessoraNoTemplate,
  payloadDeSubmissao,
  renderizarTemplate,
  templatesDaChave,
} from '@/lib/notify/whatsapp-templates'
import { lerTextosDeAcesso, montarForaDoCatalogo, montarSecoes } from '../scripts/textos-revisao'

const JSON_VERSIONADO = path.resolve(__dirname, '../docs/whatsapp-templates.json')

/** Um template pelo nome na Meta (falha alto se sumir). */
function porNome(nome: string) {
  const t = TEMPLATES_DE_WHATSAPP.find((x) => x.nome === nome)
  if (!t) throw new Error(`template sumiu: ${nome}`)
  return t
}

/**
 * AS VARIANTES, uma por decisão do despachante (o payload que a produz). Lista
 * EXPLÍCITA de propósito (achado S2 do gate Sol na PR #90): conferir só a
 * família deixaria passar um template inventado, como um `class_reminder_3h`.
 * Template novo exige uma linha aqui dizendo que decisão do envio chega nele.
 */
const VARIANTES_DO_DESPACHANTE: Readonly<Record<string, string>> = {
  class_reminder_48h_data: "marco '48h' + instance_id, aula a mais de um dia",
  class_reminder_48h_amanha: "marco '48h' + instance_id, aula amanhã no fuso do aluno, prazo de remarcar pela frente",
  class_reminder_48h_amanha_sem_prazo: "marco '48h' + instance_id, aula amanhã, prazo de remarcar já vencido no envio (#115)",
  class_reminder_48h_hoje: "marco '48h' + instance_id, aula hoje no fuso do aluno",
  class_reminder_2h_com_link: "marco '2h' com meet_url",
  class_reminder_2h_sem_link: "marco '2h' sem meet_url",
  class_reminder_antigo: 'sem marco (linha enfileirada antes dos toques de 48h e 2h)',
  class_cancelled_com_credito: 'credited = true',
  class_cancelled_sem_credito: 'credited = false',
  reschedule_confirm_remarcacao: "kind = 'reschedule'",
  reschedule_confirm_reposicao: "kind = 'redeem'",
  reschedule_confirm_escola_moveu: "moved_by = 'teacher'",
  credit_expiry_um: 'n_credits = 1',
  credit_expiry_varios: 'n_credits > 1',
  briefing_reminder: 'única',
  briefing_update_reminder: 'única',
  mentorship_eligible: 'única',
  meeting_reminder_com_link: 'com meet_url',
  meeting_reminder_sem_link: 'sem meet_url (gmeet_url nulo)',
  meeting_cancelled_escola: 'self = false',
  meeting_cancelled_aluno: 'self = true',
}

/** As chaves que o despachante sabe mandar por WhatsApp hoje. */
const CHAVES_COM_TEXTO = Object.entries(TEMPLATES)
  .filter(([, spec]) => typeof spec.text === 'function')
  .map(([chave]) => chave)
  .sort()

describe('#41 · cobertura: despachante × templates', () => {
  it('as três sem template na Meta são exatamente estas (nem mais, nem menos)', () => {
    expect([...CHAVES_SEM_TEMPLATE_NA_META].sort()).toEqual(
      ['content-digest', 'content-review', 'period-reschedule-invite'].sort(),
    )
  })

  it('toda chave com texto de WhatsApp tem template ou está na lista das três', () => {
    const comTemplate = new Set(TEMPLATES_DE_WHATSAPP.map((t) => t.chave))
    for (const chave of CHAVES_COM_TEXTO) {
      const coberta = comTemplate.has(chave) || CHAVES_SEM_TEMPLATE_NA_META.includes(chave)
      expect(coberta, `chave do despachante sem template: ${chave}`).toBe(true)
    }
  })

  it('as variantes são exatamente as decisões do despachante (nem inventada, nem esquecida)', () => {
    expect(TEMPLATES_DE_WHATSAPP.map((t) => t.nome).sort()).toEqual(Object.keys(VARIANTES_DO_DESPACHANTE).sort())
  })

  it('nenhum template órfão: toda entrada corresponde a uma chave do despachante com texto', () => {
    for (const t of TEMPLATES_DE_WHATSAPP) {
      expect(CHAVES_COM_TEXTO, `template sem chave no despachante: ${t.nome}`).toContain(t.chave)
    }
    for (const chave of CHAVES_SEM_TEMPLATE_NA_META) {
      expect(CHAVES_COM_TEXTO, `"sem template" que o despachante não conhece: ${chave}`).toContain(chave)
    }
  })

  it('as nove famílias do ADR-038, e nenhuma chave nas duas listas ao mesmo tempo', () => {
    const familias = [...new Set(TEMPLATES_DE_WHATSAPP.map((t) => t.chave))].sort()
    expect(familias).toEqual(
      [
        'class-reminder',
        'reschedule-confirm',
        'class-cancelled',
        'credit-expiry',
        'meeting-reminder',
        'meeting-cancelled',
        'mentorship-eligible',
        'briefing-reminder',
        'briefing-update-reminder',
      ].sort(),
    )
    for (const chave of CHAVES_SEM_TEMPLATE_NA_META) {
      expect(templatesDaChave(chave), chave).toEqual([])
    }
  })
})

describe('#41 · regras da Meta, template a template', () => {
  it('nome = chave com "_" + sufixo da variante; só [a-z0-9_], até 512; sem repetição', () => {
    const nomes = TEMPLATES_DE_WHATSAPP.map((t) => t.nome)
    expect(new Set(nomes).size).toBe(nomes.length)
    for (const t of TEMPLATES_DE_WHATSAPP) {
      expect(t.nome, t.nome).toMatch(/^[a-z0-9_]{1,512}$/)
      const base = t.chave.replace(/-/g, '_')
      expect(t.nome, t.nome).toBe(t.variante ? `${base}_${t.variante}` : base)
    }
  })

  it('parâmetros posicionais {{1}}…{{n}}, cada um uma vez, na ordem em que aparecem', () => {
    for (const t of TEMPLATES_DE_WHATSAPP) {
      const achados = [...t.corpo.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]))
      expect(achados, t.nome).toEqual(t.parametros.map((_, i) => i + 1))
      expect(t.parametros.length, t.nome).toBeGreaterThan(0)
      // a Meta recusa corpo que começa ou termina com variável
      expect(t.corpo, t.nome).not.toMatch(/^\s*\{\{/)
      expect(t.corpo, t.nome).not.toMatch(/\}\}\s*$/)
      // nenhuma chave do documento sobrou sem virar parâmetro
      expect(t.corpo, t.nome).not.toMatch(/\{[^{}\n]+\}(?!\})/)
    }
  })

  it('renderizado com os exemplos: nenhum parâmetro vazio ou multilinha, corpo ≤ 1024', () => {
    for (const t of TEMPLATES_DE_WHATSAPP) {
      expect(t.corpo.length, t.nome).toBeLessThanOrEqual(1024)
      for (const p of t.parametros) {
        expect(p.exemplo.trim(), `${t.nome} · ${p.nome}`).not.toBe('')
        expect(p.exemplo, `${t.nome} · ${p.nome}`).not.toMatch(/[\n\r\t]/)
        expect(p.exemplo, `${t.nome} · ${p.nome}`).not.toMatch(/ {4,}/)
        expect(p.nome, t.nome).toMatch(/^[a-z0-9_]+$/)
      }
      const renderizado = renderizarTemplate(t)
      expect(renderizado.length, t.nome).toBeLessThanOrEqual(1024)
      expect(renderizado, t.nome).not.toContain('{{')
      for (const p of t.parametros) expect(renderizado, t.nome).toContain(p.exemplo)
    }
  })

  it('o número de atendimento do rodapé é o ÚLTIMO parâmetro do corpo', () => {
    const comRodape = TEMPLATES_DE_WHATSAPP.filter((t) => t.textoDoDocumento.includes('{WhatsApp de atendimento}'))
    expect(comRodape.length).toBeGreaterThan(0)
    for (const t of comRodape) {
      expect(t.parametros.at(-1)?.nome, t.nome).toBe('whatsapp_atendimento')
    }
  })

  it('a renderização recebe os valores POR NOME: a ordem das chaves não troca o lugar do valor', () => {
    const t = porNome('class_cancelled_com_credito')
    const ex = exemplosDoTemplate(t)
    const invertido = Object.fromEntries(Object.entries(ex).reverse())
    expect(renderizarTemplate(t, invertido)).toBe(renderizarTemplate(t, ex))
    // professora e data trocadas de valor: cada uma vai para o seu lugar
    const r = renderizarTemplate(t, { ...ex, professora: 'Renata', dia_e_hora: 'sexta-feira, 13/11 às 10:00' })
    expect(r).toContain('*sexta-feira, 13/11 às 10:00* com a Teacher Renata foi *cancelada*')
  })

  it('a renderização recusa parâmetro faltando ou sobrando, vazio, multilinha ou com espaços seguidos', () => {
    const t = porNome('class_cancelled_com_credito')
    const ex = exemplosDoTemplate(t)
    expect(() => renderizarTemplate(t, {})).toThrow(/faltam/)
    expect(() => renderizarTemplate(t, { ...ex, intrusa: 'x' })).toThrow(/sobram/)
    const semValidade = Object.fromEntries(Object.entries(ex).filter(([nome]) => nome !== 'validade'))
    expect(() => renderizarTemplate(t, semValidade)).toThrow(/validade/)
    for (const ruim of ['linha\noutra', '   ', 'tab\taqui', 'Ana    Maria']) {
      expect(() => renderizarTemplate(t, { ...ex, nome: ruim }), JSON.stringify(ruim)).toThrow()
    }
    expect(renderizarTemplate(t, { ...ex, nome: 'Ana Maria' })).toContain('Olá, Ana Maria!')
  })

  it('o nome da professora entra sem "Teacher" repetido, e só onde o corpo escreve "Teacher"', () => {
    const lembrete = porNome('class_reminder_48h_data')
    const moveu = porNome('reschedule_confirm_escola_moveu')
    expect(nomeDaProfessoraNoTemplate(lembrete, 'Teacher Vicky')).toBe('Vicky')
    expect(nomeDaProfessoraNoTemplate(lembrete, ' teacher  Vicky ')).toBe('Vicky')
    expect(nomeDaProfessoraNoTemplate(lembrete, 'Vicky')).toBe('Vicky')
    // #115: "a escola moveu" passou a escrever "Teacher {professora}": prefixo sai também
    expect(nomeDaProfessoraNoTemplate(moveu, 'Teacher Vicky')).toBe('Vicky')
    expect(renderizarTemplate(lembrete, { ...exemplosDoTemplate(lembrete), professora: 'Teacher Vicky' })).toContain(
      'com a Teacher Vicky é',
    )
  })

  it('renderizado com os fatos de um envio, o template é o texto que o código manda hoje', () => {
    // Mesmo envio pelos dois caminhos: o texto livre do despachante (Evolution)
    // e o template com os valores por nome. "Teacher Vicky" no cadastro prova a
    // regra do prefixo nos dois.
    const inicio = DateTime.fromObject({ year: 2031, month: 6, day: 23, hour: 7, minute: 43 }, { zone: 'America/Sao_Paulo' })
    const doCodigo = TEMPLATES['class-cancelled'].text!(
      {
        starts_at_utc: inicio.toUTC().toISO(),
        iana_tz: 'America/Sao_Paulo',
        local_time_snapshot: '07:43',
        teacher_name: 'Teacher Vicky',
        credited: true,
        expires_on: '2031-09-14',
      },
      'Marina',
    )
    const doTemplate = renderizarTemplate(porNome('class_cancelled_com_credito'), {
      nome: 'Marina',
      dia_e_hora: inicio.setLocale('pt-BR').toFormat("cccc, dd/LL 'às' HH:mm"),
      professora: 'Teacher Vicky',
      validade: '14/09/2031',
    })
    expect(doTemplate).toBe(doCodigo)
  })

  it('a submissão: um objeto por template, UTILITY, pt_BR, BODY com o exemplo na ordem e os botões', () => {
    expect(CATEGORIA_DOS_TEMPLATES).toBe('UTILITY')
    expect(IDIOMA_DOS_TEMPLATES).toBe('pt_BR')
    const submissao = payloadDeSubmissao()
    expect(submissao.map((s) => s.name)).toEqual(TEMPLATES_DE_WHATSAPP.map((t) => t.nome))
    for (const [i, s] of submissao.entries()) {
      const t = TEMPLATES_DE_WHATSAPP[i]
      expect(s.category).toBe('UTILITY')
      expect(s.language).toBe('pt_BR')
      expect(s.components[0]).toEqual({
        type: 'BODY',
        text: t.corpo,
        example: { body_text: [t.parametros.map((p) => p.exemplo)] },
      })
      // #115: o componente BUTTONS só existe quando o template tem botão
      expect(s.components.slice(1)).toEqual(
        t.botoes.length
          ? [
              {
                type: 'BUTTONS',
                // gate Sol da PR #117: na criação, o exemplo é a URL completa
                buttons: t.botoes.map((b) => ({
                  type: 'URL',
                  text: b.texto,
                  url: b.url,
                  example: [b.url.replace('{{1}}', b.exemplo)],
                })),
              },
            ]
          : [],
      )
    }
  })

  it('o catálogo é congelado: ninguém troca um corpo em memória', () => {
    expect(Object.isFrozen(TEMPLATES_DE_WHATSAPP)).toBe(true)
    expect(Object.isFrozen(TEMPLATES_DE_WHATSAPP[0])).toBe(true)
    expect(Object.isFrozen(TEMPLATES_DE_WHATSAPP[0].parametros)).toBe(true)
    expect(Object.isFrozen(TEMPLATES_DE_WHATSAPP[0].botoes)).toBe(true)
    expect(Object.isFrozen(TEMPLATES_DE_WHATSAPP[0].botoes[0])).toBe(true)
    expect(Object.isFrozen(CHAVES_SEM_TEMPLATE_NA_META)).toBe(true)
  })
})

describe('#41 · o texto é o do documento de revisão (nenhuma palavra inventada)', () => {
  // `montarSecoes` é o gerador de `docs/goals/textos-revisao-2026-09.md` (M3-4):
  // o bloco WhatsApp de cada variante sai das mesmas funções que o envio usa.
  // Relógio dez dias à frente, como o teste do documento: o HOJE/AMANHÃ sai do
  // relógio injetado, não do dia em que a suíte roda.
  const AGORA = DateTime.now().plus({ days: 10 })
  const secoes = montarSecoes(AGORA, lerTextosDeAcesso())
  const [professoraRemarcou] = montarForaDoCatalogo()

  /** O texto do documento para um template (null = a variante não está no documento). */
  function doDocumento(t: (typeof TEMPLATES_DE_WHATSAPP)[number]): string | null {
    // Seção 22 do documento (e-mail da professora que remarcou): é o texto da
    // variante "a escola moveu" (issue #41, item 3b).
    if (t.nome === 'reschedule_confirm_escola_moveu') return professoraRemarcou.versoes[0].corpoEmail
    const secao = secoes.find((s) => s.chave === t.chave)
    if (!secao) return null
    if (secao.versoes.length === 1 && secao.versoes[0].rotulo === null) {
      // seção de versão única: só a variante principal está no documento
      return t.variante === null || t.nome === 'meeting_reminder_com_link' ? secao.versoes[0].corpoWhatsapp : null
    }
    return secao.versoes.find((v) => v.rotulo === t.rotulo)?.corpoWhatsapp ?? null
  }

  it('cada template, com as {chaves} do documento no lugar dos {{n}}, é o bloco WhatsApp da variante', () => {
    const foraDoDocumento: string[] = []
    for (const t of TEMPLATES_DE_WHATSAPP) {
      const texto = doDocumento(t)
      if (texto === null) {
        foraDoDocumento.push(t.nome)
        continue
      }
      // O e-mail (fonte do "a escola moveu") marca o negrito com <strong>, que
      // vira texto puro no documento; o WhatsApp usa *asteriscos*.
      const comparavel = (x: string) => (t.nome === 'reschedule_confirm_escola_moveu' ? x.replaceAll('*', '') : x)
      expect(comparavel(t.textoDoDocumento), t.nome).toBe(texto)
      // e o corpo da Meta é o mesmo texto, trocadas as chaves pelos {{n}}
      const deVolta = t.parametros.reduce((c, p) => c.replace(`{{${p.posicao}}}`, p.marcador), t.corpo)
      expect(comparavel(deVolta), t.nome).toBe(texto)
    }
    // A única variante que o código manda e o documento não mostra: o lembrete
    // de encontro sem link da sala (o `gmeet_url` do encontro pode ser nulo).
    expect(foraDoDocumento).toEqual(['meeting_reminder_sem_link'])
  })

  it('cada versão do documento casa com UM template só (sem dois templates para o mesmo caso)', () => {
    for (const s of secoes) {
      if (!templatesDaChave(s.chave).length) continue
      for (const v of s.versoes) {
        const iguais = TEMPLATES_DE_WHATSAPP.filter((t) => t.chave === s.chave && t.textoDoDocumento === v.corpoWhatsapp)
        expect(iguais.map((t) => t.nome), `${s.chave} · ${v.rotulo ?? 'versão única'}`).toHaveLength(1)
      }
    }
    // nenhum corpo repetido: a Meta recusa conteúdo duplicado na mesma conta e
    // idioma (revisão da PR #117 — o encontro sem sala ganhou frase própria)
    const textos = TEMPLATES_DE_WHATSAPP.map((t) => t.textoDoDocumento)
    expect(new Set(textos).size).toBe(textos.length)
  })

  it('a variante fora do documento é o texto que o código manda hoje (sem palavra nova)', () => {
    const [semLink] = TEMPLATES_DE_WHATSAPP.filter((t) => t.nome === 'meeting_reminder_sem_link')
    const inicio = DateTime.fromObject({ year: 2031, month: 6, day: 23, hour: 7, minute: 43 }, { zone: 'America/Sao_Paulo' })
    const texto = TEMPLATES['meeting-reminder'].text!(
      { starts_at_utc: inicio.toUTC().toISO(), iana_tz: 'America/Sao_Paulo', local_time_snapshot: '07:43' },
      '{nome}',
    )
    const longo = inicio.setLocale('pt-BR').toFormat("cccc, dd/LL 'às' HH:mm")
    expect(semLink.textoDoDocumento).toBe(texto.replace(longo, '{dia e hora da aula}'))
  })

  it('cada variante do documento tem template (nenhuma esquecida nas nove famílias)', () => {
    for (const s of secoes) {
      if (!templatesDaChave(s.chave).length) continue
      for (const v of s.versoes) {
        const achou = TEMPLATES_DE_WHATSAPP.some((t) => t.chave === s.chave && t.textoDoDocumento === v.corpoWhatsapp)
        expect(achou, `${s.chave} · ${v.rotulo ?? 'versão única'}`).toBe(true)
      }
    }
  })
})

describe('#41 · JSON de submissão versionado', () => {
  it('docs/whatsapp-templates.json é idêntico à saída do gerador', () => {
    // Falhou? Regenere: npm run -s whatsapp:templates > docs/whatsapp-templates.json
    expect(readFileSync(JSON_VERSIONADO, 'utf8')).toBe(jsonDeSubmissao())
  })

  it('os exemplos não têm nome de pessoa real', () => {
    const termos = termosProibidos()
    if (termos === null) avisarSemLista('whatsapp-templates')
    else expect(nomesNoTexto(jsonDeSubmissao(), termos)).toEqual([])
  })
})

describe('#41 · risco de virar marketing', () => {
  // A lista é PARCIAL (achado S4 do gate Sol na PR #90): ela barra as palavras
  // de venda, não o tom celebratório ("Boa notícia", 🎉). O tom é da dona e
  // está como pergunta no corpo da PR e na issue #41, antes do AN.6.
  it('mentorship-eligible fica só no fato: nenhuma palavra da lista de risco', () => {
    const PROIBIDAS = ['desconto', 'promocao', 'oferta', 'compre', 'garanta']
    const mentoria = templatesDaChave('mentorship-eligible')
    expect(mentoria.length).toBeGreaterThan(0)
    for (const t of mentoria) {
      const texto = semAcento(renderizarTemplate(t)).toLowerCase()
      for (const palavra of PROIBIDAS) expect(texto, `${t.nome}: ${palavra}`).not.toContain(palavra)
    }
  })
})

describe('#41 · a escola moveu (item 3b)', () => {
  it('existe como template próprio e difere da variante "você remarcou"', () => {
    const [moveu] = TEMPLATES_DE_WHATSAPP.filter((t) => t.nome === 'reschedule_confirm_escola_moveu')
    const [remarcou] = TEMPLATES_DE_WHATSAPP.filter((t) => t.nome === 'reschedule_confirm_remarcacao')
    expect(moveu).toBeDefined()
    expect(remarcou).toBeDefined()
    expect(moveu.chave).toBe('reschedule-confirm')
    expect(moveu.corpo).not.toBe(remarcou.corpo)
    expect(moveu.textoDoDocumento).toContain('a mudança partiu da escola')
  })
})

/* ========================================================================== */
/* #115 · botões, prazo de remarcar, toque de 2 h e textos revistos            */
/* ========================================================================== */

/**
 * O MAPA DOS BOTÕES da issue #115 (decisão do dono, 31/10/2026), escrito por
 * extenso: botão a mais, a menos ou trocado de lugar é vermelho aqui.
 */
const BOTOES_DA_ISSUE: Readonly<Record<string, readonly string[]>> = {
  class_reminder_48h_data: ['Ver minha aula>aula', 'Falar com a gente>atendimento'],
  class_reminder_48h_amanha: ['Ver minha aula>aula', 'Falar com a gente>atendimento'],
  class_reminder_48h_amanha_sem_prazo: ['Ver minha aula>aula', 'Falar com a gente>atendimento'],
  class_reminder_48h_hoje: ['Ver minha aula>aula', 'Falar com a gente>atendimento'],
  class_reminder_2h_com_link: ['Entrar na aula>sala', 'Confirmar presença>aula'],
  class_reminder_2h_sem_link: ['Confirmar presença>aula', 'Falar com a gente>atendimento'],
  class_reminder_antigo: ['Falar com a gente>atendimento'],
  class_cancelled_com_credito: ['Agendar reposição>creditos', 'Falar com a gente>atendimento'],
  class_cancelled_sem_credito: ['Falar com a gente>atendimento'],
  reschedule_confirm_remarcacao: ['Ver minha aula>aula', 'Falar com a gente>atendimento'],
  reschedule_confirm_reposicao: ['Ver minha aula>aula', 'Falar com a gente>atendimento'],
  reschedule_confirm_escola_moveu: ['Ver minha aula>aula', 'Falar com a gente>atendimento'],
  credit_expiry_um: ['Usar meu crédito>creditos', 'Falar com a gente>atendimento'],
  credit_expiry_varios: ['Usar meu crédito>creditos', 'Falar com a gente>atendimento'],
  briefing_reminder: ['Responder briefing>briefing', 'Falar com a gente>atendimento'],
  briefing_update_reminder: ['Atualizar briefing>briefing_atualizar', 'Falar com a gente>atendimento'],
  mentorship_eligible: ['Escolher data>mentoria', 'Falar com a gente>atendimento'],
  meeting_reminder_com_link: ['Entrar no encontro>sala'],
  // revisão da PR #117 (decisão da orquestradora): sem sala do Meet, a saída
  // é o atendimento — a tela da mentoria nem sempre mostra o link
  meeting_reminder_sem_link: ['Falar com a gente>atendimento'],
  meeting_cancelled_escola: ['Escolher outra data>mentoria', 'Falar com a gente>atendimento'],
  meeting_cancelled_aluno: ['Escolher outra data>mentoria', 'Falar com a gente>atendimento'],
}

/** Telefone que pode aparecer no repositório: só as faixas de `.claude/rules/dados-de-teste.md`. */
const TELEFONE_FICTICIO = /^(55659000\d{5}|556599999\d{4}|1\d{3}55501\d{2}|351900\d{6})$/

describe('#115 · limites da Meta, template a template', () => {
  // Fonte: developers.facebook.com/documentation/business-messaging/whatsapp/templates/components
  // (lida em 31/10/2026): até 2 botões de URL, texto até 25 caracteres, UMA
  // variável {{1}} no fim da URL, com exemplo.
  const submissao = payloadDeSubmissao()

  it('são 21 templates (o 48h_amanha_sem_prazo nasceu na #115)', () => {
    expect(TEMPLATES_DE_WHATSAPP).toHaveLength(21)
    expect(submissao).toHaveLength(21)
  })

  it('os botões de cada template são exatamente os do mapa da issue', () => {
    const doCodigo = Object.fromEntries(
      TEMPLATES_DE_WHATSAPP.map((t) => [t.nome, t.botoes.map((b) => `${b.texto}>${b.destino}`)]),
    )
    expect(doCodigo).toEqual(BOTOES_DA_ISSUE)
  })

  it('no JSON: até 2 botões URL, texto até 25, {{1}} só no fim da URL, exemplo válido', () => {
    expect(MAXIMO_DE_BOTOES_DE_URL).toBe(2)
    expect(MAXIMO_DO_TEXTO_DO_BOTAO).toBe(25)
    for (const s of submissao) {
      const corpo = s.components.find((c) => c.type === 'BODY')!
      expect('text' in corpo && corpo.text.length, s.name).toBeLessThanOrEqual(1024)
      const botoes = s.components.flatMap((c) => (c.type === 'BUTTONS' ? c.buttons : []))
      expect(botoes.length, s.name).toBeLessThanOrEqual(2)
      expect(s.components.filter((c) => c.type === 'BUTTONS').length, s.name).toBeLessThanOrEqual(1)
      botoes.forEach((b, i) => {
        const onde = `${s.name} · botão ${i}`
        expect(b.type, onde).toBe('URL')
        expect(b.text.length, onde).toBeGreaterThan(0)
        expect(b.text.length, onde).toBeLessThanOrEqual(25)
        expect(b.url, onde).toMatch(/^https:\/\/[^{}]+\/\{\{1\}\}$/)
        expect(b.url.match(/\{\{/g), onde).toHaveLength(1)
        expect(b.example, onde).toHaveLength(1)
        expect(b.example[0], onde).toMatch(/^\S+$/)
        // gate Sol da PR #117: na criação, o exemplo é a URL COMPLETA (o sufixo
        // sozinho é só no envio) — e ela é um endereço que abre, com a mesma base
        expect(() => new URL(b.example[0]), onde).not.toThrow()
        expect(b.example[0].startsWith(b.url.replace('{{1}}', '')), onde).toBe(true)
        expect(b.example[0], onde).not.toContain('{{')
      })
    }
  })

  it('nenhum parâmetro do corpo vazio nem com quebra de linha, nos exemplos da submissão', () => {
    for (const s of submissao) {
      const corpo = s.components.find((c) => c.type === 'BODY')!
      const exemplos = 'example' in corpo ? (corpo.example as { body_text: string[][] }).body_text[0] : []
      for (const e of exemplos) {
        expect(e.trim(), s.name).not.toBe('')
        expect(e, s.name).not.toMatch(/[\n\r\t]/)
      }
    }
  })

  it('nenhum telefone nem URL real no JSON: só as faixas fictícias e os endereços do app, do wa.me e do Meet', () => {
    const json = jsonDeSubmissao()
    // o id de aula de exemplo é um UUID de zeros: não é telefone
    const semIds = json.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '')
    for (const numero of semIds.match(/\d{10,}/g) ?? []) expect(numero).toMatch(TELEFONE_FICTICIO)
    const hosts = new Set([...json.matchAll(/https:\/\/([^/"\s]+)/g)].map((m) => m[1]))
    expect([...hosts].sort()).toEqual(['app.personal-teacher.com', 'meet.google.com', 'wa.me'].sort())
  })

  it('o corpo não carrega mais os links que viraram botão', () => {
    for (const t of TEMPLATES_DE_WHATSAPP) {
      for (const linha of [
        'Confirmar presença, remarcar ou cancelar',
        'Dúvidas? Fale com a gente',
        'Entrar na aula:',
        'Entrar no encontro:',
        'Responder agora',
        'Atualizar agora',
      ]) {
        expect(t.corpo, `${t.nome}: ${linha}`).not.toContain(linha)
      }
      // nenhum endereço escrito no corpo: link é botão ou parâmetro
      expect(t.corpo, t.nome).not.toContain('https://')
      expect(t.textoDoDocumento.endsWith('Equipe Personal Teacher Academy'), t.nome).toBe(true)
    }
  })

  it('o sufixo de botão vazio ou com espaço é recusado antes de sair', () => {
    const t = porNome('credit_expiry_um')
    expect(botoesEmOrdem(t, { creditos: 'portal/creditos', atendimento: '5565900000001' })).toEqual([
      'portal/creditos',
      '5565900000001',
    ])
    expect(() => botoesEmOrdem(t, { creditos: 'portal/creditos' })).toThrow(/sufixo inválido/)
    expect(() => botoesEmOrdem(t, { creditos: 'portal/creditos', atendimento: '' })).toThrow(/sufixo inválido/)
    expect(() => botoesEmOrdem(t, { creditos: 'portal/ creditos', atendimento: '5565900000001' })).toThrow(/sufixo inválido/)
  })
})

describe('#115 · o que cada aviso diz', () => {
  const PRAZO = 'Precisa mudar? Dá para remarcar até *{prazo}*.'
  const IMPREVISTO = 'Imprevisto? Fale com a gente.'

  it('48 h com prazo pela frente: a linha do prazo; hoje e amanhã já vencido: sem ela, com o atendimento', () => {
    for (const nome of ['class_reminder_48h_data', 'class_reminder_48h_amanha']) {
      expect(porNome(nome).textoDoDocumento, nome).toContain(PRAZO)
      expect(porNome(nome).parametros.map((p) => p.nome), nome).toContain('prazo')
    }
    for (const nome of ['class_reminder_48h_hoje', 'class_reminder_48h_amanha_sem_prazo']) {
      const t = porNome(nome)
      expect(t.textoDoDocumento, nome).not.toContain('{prazo}')
      expect(t.textoDoDocumento, nome).not.toContain('remarcar')
      expect(t.textoDoDocumento, nome).toContain(IMPREVISTO)
    }
  })

  it('2 h: não oferece remarcar nem cancelar; pede a presença e aponta o atendimento', () => {
    for (const nome of ['class_reminder_2h_com_link', 'class_reminder_2h_sem_link']) {
      const t = porNome(nome)
      const texto = semAcento(renderizarTemplate(t)).toLowerCase()
      expect(texto, nome).not.toContain('remarcar')
      expect(texto, nome).not.toContain('cancelar')
      expect(t.textoDoDocumento, nome).toContain('Confirme sua presença no botão abaixo.')
      expect(t.textoDoDocumento, nome).toMatch(/Imprevisto\? Fale com a gente[.:]/)
    }
    // com sala, os botões são a sala e a presença: o atendimento fica no texto
    expect(porNome('class_reminder_2h_com_link').textoDoDocumento).toContain(
      'Imprevisto? Fale com a gente: {WhatsApp de atendimento}',
    )
    expect(porNome('class_reminder_2h_sem_link').textoDoDocumento).toContain(IMPREVISTO)
  })

  const MOVEU =
    'Oi, {nome}! Confirmando a remarcação combinada com a Teacher {professora}: sua aula de ' +
    '*{data da aula} às {hora da aula}* passou para *{nova data} às {nova hora}* (horário de {cidade}). ✅\n\n' +
    'Essa mudança partiu da escola: não usa suas remarcações do mês nem crédito.\n\n' +
    'Equipe Personal Teacher Academy'

  it('a escola moveu: exatamente o texto aprovado, e o e-mail diz o mesmo', () => {
    const t = porNome('reschedule_confirm_escola_moveu')
    expect(t.textoDoDocumento).toBe(MOVEU)
    // mesmo envio pelos dois canais: aluna em Lisboa, professora "Teacher Vicky"
    const antes = DateTime.fromObject({ year: 2031, month: 3, day: 4, hour: 9 }, { zone: 'Europe/Lisbon' })
    const depois = DateTime.fromObject({ year: 2031, month: 3, day: 6, hour: 10, minute: 30 }, { zone: 'Europe/Lisbon' })
    const email = teacherMovedEmail({
      firstName: 'Marina',
      studentTz: 'Europe/Lisbon',
      oldStartsUtc: antes.toUTC().toISO()!,
      newStartsUtc: depois.toUTC().toISO()!,
      teacherName: 'Teacher Vicky',
    })
    const whatsapp = renderizarTemplate(t, {
      nome: 'Marina',
      professora: 'Teacher Vicky',
      data_original: '04/03',
      hora: '09:00',
      nova_data: '06/03',
      nova_hora: '10:30',
      cidade: 'Lisboa',
    })
    expect(whatsapp).toContain('com a Teacher Vicky:')
    const corpoDoEmail = textoDoHtml(email.html)
    expect(corpoDoEmail).toContain(whatsapp.replaceAll('*', ''))
    expect(corpoDoEmail).not.toContain('Teacher Teacher')
  })

  it('crédito vencendo: o botão e o e-mail levam à tela de créditos', () => {
    for (const t of templatesDaChave('credit-expiry')) {
      expect(t.botoes[0].destino, t.nome).toBe('creditos')
      expect(t.botoes[0].exemplo, t.nome).toBe('portal/creditos')
      expect(t.textoDoDocumento, t.nome).toContain('escolher um dos horários disponíveis.\n\n')
    }
    const email = creditExpiryEmail({ firstName: 'Marina', nCredits: 2, expiresOn: '2031-02-12', appUrl: 'https://app.exemplo.com' })
    expect(email.html).toContain('href="https://app.exemplo.com/portal/creditos"')
    expect(email.html).not.toContain('href="https://app.exemplo.com/portal"')
  })

  it('frases que perderam o link só trocaram os dois-pontos pelo ponto', () => {
    expect(porNome('mentorship_eligible').textoDoDocumento).toContain('escolher uma das datas disponíveis.\n\n')
    for (const nome of ['meeting_cancelled_escola', 'meeting_cancelled_aluno']) {
      expect(porNome(nome).textoDoDocumento, nome).toContain('*Seu crédito de mentoria já voltou* — escolha outra data.\n\n')
    }
  })
})

/* ========================================================================== */
/* Revisão da PR #117 · os e-mails do mesmo aviso                              */
/* ========================================================================== */

describe('#115 · e-mail dos toques de 48 h e 2 h, com o relógio injetado', () => {
  /** Renderiza com o relógio do Luxon apontado para `agora` e o devolve no fim. */
  function comRelogio<T>(agora: DateTime, f: () => T): T {
    const antes = Settings.now
    Settings.now = () => agora.toMillis()
    try {
      return f()
    } finally {
      Settings.now = antes
    }
  }
  const longoEm = (dt: DateTime, tz: string) => dt.setZone(tz).setLocale('pt-BR').toFormat("cccc, dd/LL 'às' HH:mm")
  const lembrete = (inicio: DateTime, tz: string, marco: '48h' | '2h', minNoticeHours: number | null = 24) =>
    classReminderEmail({
      firstName: 'Marina',
      startsAtUtc: inicio.toUTC().toISO()!,
      ianaTz: tz,
      localTimeSnapshot: inicio.setZone(tz).toFormat('HH:mm'),
      teacherName: 'Teacher Vicky',
      marco,
      instanceId: '00000000-0000-0000-0000-0000000000aa',
      meetUrl: 'https://meet.google.com/abc-defg-hij',
      minNoticeHours,
    })
  const texto = (html: string) => semAcento(textoDoHtml(html)).toLowerCase()

  const tz = 'America/Cuiaba'
  const dia = DateTime.now().setZone(tz).plus({ days: 30 }).startOf('day')

  it('48 h, amanhã com o prazo pela frente: a linha do prazo', () => {
    const inicio = dia.plus({ days: 1 }).set({ hour: 23 })
    const { html } = comRelogio(dia.set({ hour: 17 }), () => lembrete(inicio, tz, '48h'))
    expect(html).toContain(`Precisa mudar? Dá para remarcar até <strong>${longoEm(inicio.minus({ hours: 24 }), tz)}</strong>.`)
    expect(html).not.toContain('Imprevisto')
  })

  it('48 h, amanhã com o prazo vencido: "Imprevisto?", sem prometer remarcar', () => {
    const { html } = comRelogio(dia.set({ hour: 13 }), () => lembrete(dia.plus({ days: 1 }).set({ hour: 9 }), tz, '48h'))
    expect(html).toContain('Imprevisto? ')
    expect(texto(html)).not.toContain('remarcar')
  })

  it('48 h, hoje: "Imprevisto?", sem prometer remarcar', () => {
    const { html } = comRelogio(dia.set({ hour: 8 }), () => lembrete(dia.set({ hour: 20 }), tz, '48h'))
    expect(html).toContain('Imprevisto? ')
    expect(texto(html)).not.toContain('remarcar')
  })

  it('48 h com o aviso mínimo do contrato desconhecido: sem prazo inventado', () => {
    const { html } = comRelogio(dia, () => lembrete(dia.plus({ days: 3 }).set({ hour: 9 }), tz, '48h', null))
    expect(texto(html)).not.toContain('remarcar ate')
    expect(html).toContain('Imprevisto? ')
  })

  it('2 h: confirma presença e aponta o atendimento, sem remarcar nem cancelar', () => {
    const { html } = comRelogio(dia.set({ hour: 18 }), () => lembrete(dia.set({ hour: 20 }), tz, '2h'))
    expect(texto(html)).not.toContain('remarcar')
    expect(texto(html)).not.toContain('cancelar')
    expect(textoDoHtml(html)).toContain('Confirmar presença')
    expect(html).toContain('Imprevisto? ')
  })

  /** O dia em que o relógio de `tz` AVANÇA (entra no horário de verão), a partir de amanhã. */
  function proximoAvanco(zona: string): DateTime {
    let d = DateTime.now().setZone(zona).plus({ days: 1 }).set({ hour: 12, minute: 0, second: 0, millisecond: 0 })
    for (let i = 0; i < 400; i++, d = d.plus({ days: 1 })) {
      if (d.isInDST && !d.minus({ days: 1 }).isInDST) return d.startOf('day')
    }
    throw new Error(`${zona} não avança o relógio em 400 dias`)
  }

  it('virada de horário de verão: aula a dois dias com o prazo já vencido sai com "Imprevisto?" no e-mail', () => {
    // A aula é à 00:30 da segunda e o aviso sai às 23:59 do sábado (aula criada
    // em cima da hora). Entre os dois, o relógio adianta 1 h na madrugada de
    // domingo: são 23 h 31 min, e o prazo de 24 h já passou, embora o rótulo
    // seja de "daqui a mais de um dia".
    for (const zona of ['Europe/Lisbon', 'America/New_York']) {
      const domingo = proximoAvanco(zona)
      const inicio = domingo.plus({ days: 1 }).set({ hour: 0, minute: 30 })
      const agora = domingo.minus({ days: 1 }).set({ hour: 23, minute: 59 })
      expect(inicio.diff(agora, 'hours').hours, zona).toBeLessThan(24)
      const { html } = comRelogio(agora, () => lembrete(inicio, zona, '48h'))
      expect(html, zona).toContain('Imprevisto? ')
      expect(texto(html), zona).not.toContain('remarcar')
      // caso conhecido no WhatsApp: a variante "data" ainda escreveria o prazo
      // (decisão (c) do dono), mas o envio das 23:59 fica segurado pelo
      // silêncio das 21h às 8h e, às 8h, a aula já é "amanhã" e sai sem prazo
      expect(prazoDoToqueDe48h(inicio.toUTC().toISO()!, zona, 24, agora), zona).not.toBeNull()
      expect(prazoDoToqueDe48h(inicio.toUTC().toISO()!, zona, 24, agora.plus({ hours: 8, minutes: 1 })), zona).toBeNull()
    }
  })
})

describe('#115 · e-mail de aula cancelada com o mesmo destino do WhatsApp (gate Sol, PR #117)', () => {
  const fatos = {
    firstName: 'Marina',
    startsAtUtc: DateTime.now().plus({ days: 3 }).toUTC().toISO()!,
    ianaTz: 'America/Cuiaba',
    localTimeSnapshot: '09:00',
    teacherName: 'Teacher Vicky',
    appUrl: 'https://app.exemplo.com',
  }

  it('com crédito: "Agendar reposição" leva à tela de créditos', () => {
    const { html } = classCancelledEmail({ ...fatos, credited: true, expiresOn: '2031-02-12' })
    expect(html).toContain('href="https://app.exemplo.com/portal/creditos"')
    expect(textoDoHtml(html)).toContain('Agendar reposição')
    expect(textoDoHtml(html)).not.toContain('Ver minhas aulas')
  })

  it('sem crédito: o genérico "Ver minhas aulas"', () => {
    const { html } = classCancelledEmail({ ...fatos, credited: false })
    expect(html).toContain('href="https://app.exemplo.com/portal"')
    expect(textoDoHtml(html)).toContain('Ver minhas aulas')
    expect(html).not.toContain('/portal/creditos')
  })
})
