// ONDA AGENDA E MENSAGENS · M3-4 — o documento de revisão dos textos.
//
// Teste PURO, sem banco: o script monta uma seção por mensagem do catálogo de
// Ajustes, sem HTML no corpo, sem nome de pessoa e sem data de exemplo
// escapando dos marcadores. O que ele NÃO prova é a voz dos textos — isso é
// julgamento da dona, no documento.

import { readdirSync } from 'node:fs'
import path from 'node:path'

import { DateTime, Settings } from 'luxon'
import { describe, expect, it, vi } from 'vitest'
import { avisarSemLista, nomesNoTexto, termosProibidos } from './helpers/nomes-proibidos'

// O rodapé "fale com a gente" só existe com o número de atendimento na config.
// O teste fixa um número fictício ANTES dos imports abaixo (o link é lido na
// carga do módulo), para não depender da env de quem roda nem usar a real.
vi.hoisted(() => {
  process.env.WHATSAPP_ATENDIMENTO_E164 = '+5565900000001'
})

import { catalogoDeMensagens } from '@/data/admin/ajustes-mensagens'
import * as briefing from '@/lib/email/briefing-reminder'
import * as briefingUpdate from '@/lib/email/briefing-update-reminder'
import * as classNotices from '@/lib/email/class-notices'
import * as contentDigest from '@/lib/email/content-digest'
import * as contentReview from '@/lib/email/content-review'
import * as creditExpiry from '@/lib/email/credit-expiry'
import * as reschedule from '@/lib/email/reschedule'
import * as studentWhatsapp from '@/lib/email/student-whatsapp-changed'
import * as teacherNotices from '@/lib/email/teacher-notices'
import {
  FUNCOES_COBERTAS,
  lerTextosDeAcesso,
  marcar,
  montarDocumento,
  montarForaDoCatalogo,
  montarSecoes,
} from '../scripts/textos-revisao'

// Dez dias à frente do relógio real, de propósito: se o script deixar de
// injetar `AGORA` no Luxon, o HOJE/AMANHÃ sai pelo dia real e o teste do
// relógio fica vermelho (com `DateTime.now()` os dois dias coincidiriam).
const AGORA = DateTime.now().plus({ days: 10 })
const ACESSO = lerTextosDeAcesso()

const secoes = montarSecoes(AGORA, ACESSO)
const foraDoCatalogo = montarForaDoCatalogo()
const documento = montarDocumento(AGORA, ACESSO)
const textos = [...secoes, ...foraDoCatalogo].flatMap((s) => s.versoes.flatMap((v) => [v.assunto, v.corpoEmail, v.corpoWhatsapp]))
const preenchidos = textos.filter((t): t is string => t !== null)

describe('M3-4 · textos para revisão da dona', () => {
  it('monta uma seção por mensagem do catálogo, na ordem dele', () => {
    const doCatalogo = catalogoDeMensagens(AGORA).flatMap((b) => b.mensagens.map((m) => m.nome))
    expect(secoes.map((s) => s.nome)).toEqual(doCatalogo)
    expect(documento.match(/^### \d+\. /gm)).toHaveLength(doCatalogo.length + foraDoCatalogo.length)
  })

  it('cada seção tem chave, canal, gatilho, destinatário e o bloco da edição da dona', () => {
    for (const s of secoes) {
      expect(s.chave, s.nome).not.toBe('')
      expect(s.canais.length, s.nome).toBeGreaterThan(0)
      expect(s.gatilho, s.nome).not.toBe('')
      expect(s.destinatario, s.nome).not.toBe('')
    }
    // uma por seção + a da moldura do e-mail
    expect(documento.match(/\*\*Edição da dona:\*\*/g)).toHaveLength(secoes.length + foraDoCatalogo.length + 1)
  })

  it('todo e-mail tem assunto e corpo; mensagem de WhatsApp tem corpo', () => {
    for (const s of secoes) {
      for (const v of s.versoes) {
        if (s.canais.includes('E-mail')) {
          expect(v.assunto, s.nome).toBeTruthy()
          expect(v.corpoEmail, s.nome).toBeTruthy()
        }
        if (s.canais.includes('WhatsApp')) expect(v.corpoWhatsapp, s.nome).toBeTruthy()
      }
    }
  })

  it('não deixa HTML nem entidade no texto', () => {
    expect(preenchidos.length).toBeGreaterThan(0)
    for (const t of preenchidos) {
      expect(t).not.toMatch(/<\/?[a-z!][^>]*>/i)
      expect(t).not.toMatch(/&(#\d+|[a-z]+);/i)
      expect(t).not.toContain('{{')
    }
  })

  it('não tem nome de pessoa: dona, professora e aluno são marcadores', () => {
    // Os nomes de exemplo do catálogo (fictícios) viram marcador…
    expect(documento).not.toMatch(/Vicky|Renata|Marina|Rafael/)
    // …e nenhum nome REAL entra: a lista local do scanner, quando existe.
    const termos = termosProibidos()
    if (termos === null) avisarSemLista('textos-revisao')
    else expect(nomesNoTexto(documento, termos)).toEqual([])
    expect(documento).toContain('{nome}')
    expect(documento).toContain('{professora}')
    expect(documento).toContain('{aluno}')
  })

  it('data, hora e número de exemplo viram marcador', () => {
    expect(documento).not.toContain('2031')
    expect(documento).toContain('{dia e hora da aula}')
    expect(documento).toContain('{data de validade}')
    expect(documento).toContain('{WhatsApp de atendimento}')
    expect(documento).not.toContain('wa.me')
  })

  it('inclui os rascunhos de julho (lembrete, confirmação de remarcação, mentoria liberada)', () => {
    const rascunhos = secoes.filter((s) => s.situacao.startsWith('Rascunho de julho'))
    expect(rascunhos.map((s) => s.chave).sort()).toEqual(['class-reminder', 'mentorship-eligible', 'reschedule-confirm'])
    for (const s of rascunhos) {
      expect(s.versoes.length, s.chave).toBeGreaterThan(0)
      expect(s.versoes.every((v) => v.corpoWhatsapp), s.chave).toBe(true)
    }
  })

  it('o HOJE/AMANHÃ do lembrete segue o relógio injetado, e o relógio do Luxon volta ao que era', () => {
    const lembrete = secoes.find((s) => s.chave === 'class-reminder')!
    const textoDe = (rotulo: string) => lembrete.versoes.find((v) => v.rotulo?.includes(rotulo))?.corpoWhatsapp
    expect(textoDe('amanhã')).toContain('*AMANHÃ às {hora da aula}*')
    expect(textoDe('hoje')).toContain('HOJE às {hora da aula}')
    expect(Math.abs(Settings.now() - Date.now())).toBeLessThan(5_000)
  })

  it('mostra toda função de texto de src/lib/email (função nova sem seção fica vermelha)', () => {
    const modulos = [briefing, briefingUpdate, classNotices, contentDigest, contentReview, creditExpiry, reschedule, studentWhatsapp, teacherNotices]
    // a moldura da marca não é mensagem: aparece uma vez, no topo do documento
    const exportadas = modulos
      .flatMap((m) => Object.entries(m))
      .filter(([nome, valor]) => typeof valor === 'function' && /(Email|Text)$/.test(nome) && nome !== 'brandEmail')
      .map(([nome]) => nome)
    expect([...exportadas].sort()).toEqual([...FUNCOES_COBERTAS].sort())
    // arquivo novo em src/lib/email também precisa entrar na lista de cima
    const infra = ['brand.ts', 'notify.ts', 'send.ts']
    const arquivos = readdirSync(path.resolve(__dirname, '../src/lib/email')).filter((f) => !infra.includes(f))
    expect(arquivos).toHaveLength(modulos.length)
  })

  it('é determinístico: duas gerações no mesmo dia saem iguais', () => {
    expect(montarDocumento(AGORA, ACESSO)).toBe(documento)
  })

  it('para em vez de gerar data inventada quando sobra sentinela', () => {
    expect(() => marcar('aula em 2031')).toThrow(/sentinela/)
  })
})
