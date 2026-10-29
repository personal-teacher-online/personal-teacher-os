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
//   4. O JSON versionado (`docs/ops/whatsapp-templates.json`) é a saída do
//      gerador: mudar texto sem regenerar fica vermelho;
//   5. a mentoria liberada não tem palavra que a Meta lê como marketing;
//   6. a variante "a escola moveu" existe e não é a de "você remarcou".

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { DateTime } from 'luxon'
import { describe, expect, it, vi } from 'vitest'
import { avisarSemLista, nomesNoTexto, semAcento, termosProibidos } from './helpers/nomes-proibidos'

// O rodapé "fale com a gente" só existe com o número de atendimento na config:
// número fictício fixado ANTES dos imports (o link é lido na carga do módulo).
vi.hoisted(() => {
  process.env.WHATSAPP_ATENDIMENTO_E164 = '+5565900000001'
})

import { TEMPLATES } from '@/lib/outbox/dispatch'
import {
  CATEGORIA_DOS_TEMPLATES,
  CHAVES_SEM_TEMPLATE_NA_META,
  IDIOMA_DOS_TEMPLATES,
  TEMPLATES_DE_WHATSAPP,
  jsonDeSubmissao,
  payloadDeSubmissao,
  renderizarTemplate,
  templatesDaChave,
} from '@/lib/notify/whatsapp-templates'
import { lerTextosDeAcesso, montarForaDoCatalogo, montarSecoes } from '../scripts/textos-revisao'

const JSON_VERSIONADO = path.resolve(__dirname, '../docs/ops/whatsapp-templates.json')

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

  it('a renderização recusa lista de valores do tamanho errado ou com quebra de linha', () => {
    const t = TEMPLATES_DE_WHATSAPP[0]
    expect(() => renderizarTemplate(t, [])).toThrow()
    const valores = t.parametros.map((p) => p.exemplo)
    valores[0] = 'linha\noutra'
    expect(() => renderizarTemplate(t, valores)).toThrow()
    valores[0] = '   '
    expect(() => renderizarTemplate(t, valores)).toThrow()
    valores[0] = 'Ana    Maria'
    expect(() => renderizarTemplate(t, valores)).toThrow()
    valores[0] = 'Ana Maria'
    expect(renderizarTemplate(t, valores)).toContain('Ana Maria')
  })

  it('a submissão: um objeto por template, UTILITY, pt_BR, BODY com o exemplo na ordem', () => {
    expect(CATEGORIA_DOS_TEMPLATES).toBe('UTILITY')
    expect(IDIOMA_DOS_TEMPLATES).toBe('pt_BR')
    const submissao = payloadDeSubmissao()
    expect(submissao.map((s) => s.name)).toEqual(TEMPLATES_DE_WHATSAPP.map((t) => t.nome))
    for (const [i, s] of submissao.entries()) {
      const t = TEMPLATES_DE_WHATSAPP[i]
      expect(s.category).toBe('UTILITY')
      expect(s.language).toBe('pt_BR')
      expect(s.components).toEqual([
        { type: 'BODY', text: t.corpo, example: { body_text: [t.parametros.map((p) => p.exemplo)] } },
      ])
    }
  })

  it('o catálogo é congelado: ninguém troca um corpo em memória', () => {
    expect(Object.isFrozen(TEMPLATES_DE_WHATSAPP)).toBe(true)
    expect(Object.isFrozen(TEMPLATES_DE_WHATSAPP[0])).toBe(true)
    expect(Object.isFrozen(TEMPLATES_DE_WHATSAPP[0].parametros)).toBe(true)
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
      expect(t.textoDoDocumento, t.nome).toBe(texto)
      // e o corpo da Meta é o mesmo texto, trocadas as chaves pelos {{n}}
      const deVolta = t.parametros.reduce((c, p) => c.replace(`{{${p.posicao}}}`, p.marcador), t.corpo)
      expect(deVolta, t.nome).toBe(texto)
    }
    // A única variante que o código manda e o documento não mostra: o lembrete
    // de encontro sem link da sala (o `gmeet_url` do encontro pode ser nulo).
    expect(foraDoDocumento).toEqual(['meeting_reminder_sem_link'])
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
  it('docs/ops/whatsapp-templates.json é idêntico à saída do gerador', () => {
    // Falhou? Regenere: npm run -s whatsapp:templates > docs/ops/whatsapp-templates.json
    expect(readFileSync(JSON_VERSIONADO, 'utf8')).toBe(jsonDeSubmissao())
  })

  it('os exemplos não têm nome de pessoa real', () => {
    const termos = termosProibidos()
    if (termos === null) avisarSemLista('whatsapp-templates')
    else expect(nomesNoTexto(jsonDeSubmissao(), termos)).toEqual([])
  })
})

describe('#41 · risco de virar marketing', () => {
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
