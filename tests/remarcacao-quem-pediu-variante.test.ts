// Issue #192 — qual TEXTO sai quando uma aula é remarcada, conforme quem pediu.
//
// Conta pura (sem banco): o aviso da fila chega com `requested_by` (gravado
// pelo banco a partir do audit da remarcação) e o despachante escolhe a
// variante do catálogo aprovado na Meta. Não há modelo novo:
//   · a escola pediu  → `reschedule_confirm_escola_moveu`
//   · o aluno pediu   → `reschedule_confirm_remarcacao` (ou `_reposicao` no resgate)
// O e-mail equivalente é provado contra o banco em
// `tests/remarcacao-admin-quem-pediu.test.ts`; aqui, o texto dele.
import { describe, expect, it } from 'vitest'

import { schoolMovedTeacherEmail, teacherMovedEmail } from '@/lib/email/reschedule'
import { whatsappDoAviso } from '@/lib/outbox/whatsapp-do-aviso'

// Calendário fixo de propósito: conta pura de fuso, sem banco e sem relógio.
const ORIGINAL = '2026-08-04T18:00:00.000Z' // 14:00 em Cuiabá
const NOVA = '2026-08-06T19:30:00.000Z' // 15:30 em Cuiabá
const FATOS = {
  nome: 'Marina',
  atendimentoUrl: 'https://wa.me/5565900000001',
  agora: new Date('2026-08-01T12:00:00.000Z'),
}

function aviso(extra: Record<string, unknown>) {
  return whatsappDoAviso(
    'reschedule-confirm',
    {
      instance_id: '00000000-0000-4000-8000-000000000001',
      starts_at_utc: NOVA,
      local_time_snapshot: '2026-08-06 15:30 America/Cuiaba',
      iana_tz: 'America/Cuiaba',
      teacher_name: 'Teacher Ana',
      ...extra,
    },
    FATOS,
  )
}

function nomeDoModelo(extra: Record<string, unknown>): string {
  const r = aviso(extra)
  if (!r.ok) throw new Error(`o aviso ficou preso: ${r.motivo} (${r.detalhe})`)
  return r.template.nome
}

describe('#192 · WhatsApp: a variante segue quem pediu a mudança', () => {
  it('a administração remarcou a pedido da ESCOLA → "a escola moveu", com a aula original e a nova', () => {
    const r = aviso({
      kind: 'reschedule',
      moved_by: 'admin',
      requested_by: 'school',
      original_starts_at_utc: ORIGINAL,
    })
    if (!r.ok) throw new Error(`o aviso ficou preso: ${r.motivo} (${r.detalhe})`)
    expect(r.template.nome).toBe('reschedule_confirm_escola_moveu')
    expect(r.texto).toContain('sua aula de *04/08 às 14:00* passou para *06/08 às 15:30*')
    expect(r.texto).toContain('Essa mudança partiu da escola: não usa suas remarcações do mês nem crédito.')
    expect(r.texto).not.toContain('remarcação está confirmada')
  })

  it('a administração remarcou a pedido do ALUNO → "remarcação confirmada" (com ou sem cortesia o aviso é o mesmo)', () => {
    expect(nomeDoModelo({ kind: 'reschedule', moved_by: 'admin', requested_by: 'student' })).toBe(
      'reschedule_confirm_remarcacao',
    )
  })

  it('o aluno remarcou pelo portal e o resgate de crédito continuam como eram', () => {
    expect(nomeDoModelo({ kind: 'reschedule', moved_by: 'student', requested_by: 'student' })).toBe(
      'reschedule_confirm_remarcacao',
    )
    // resgate: não há pedido de mudança (o banco grava `requested_by` nulo)
    expect(nomeDoModelo({ kind: 'redeem', moved_by: 'student', requested_by: null })).toBe(
      'reschedule_confirm_reposicao',
    )
    expect(nomeDoModelo({ kind: 'redeem', moved_by: 'admin', requested_by: null })).toBe(
      'reschedule_confirm_reposicao',
    )
  })

  it('a professora pelo painel dela continua "a escola moveu" — inclusive no aviso enfileirado antes da #192', () => {
    const comOriginal = { kind: 'reschedule', original_starts_at_utc: ORIGINAL }
    expect(nomeDoModelo({ ...comOriginal, moved_by: 'teacher', requested_by: 'school' })).toBe(
      'reschedule_confirm_escola_moveu',
    )
    // linha antiga na fila: só `moved_by`, sem `requested_by`
    expect(nomeDoModelo({ ...comOriginal, moved_by: 'teacher' })).toBe('reschedule_confirm_escola_moveu')
  })

  it('PROVA DE MUTAÇÃO: sem `requested_by`, a mesma remarcação da admin sairia como pedido do aluno', () => {
    expect(nomeDoModelo({ kind: 'reschedule', moved_by: 'admin' })).toBe('reschedule_confirm_remarcacao')
  })

  it('a escola pediu mas falta o horário da aula original: a linha fica PRESA, não sai texto trocado', () => {
    const r = aviso({ kind: 'reschedule', moved_by: 'admin', requested_by: 'school' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toContain('falta o horário da aula original')
  })
})

describe('#192 · e-mail: os dois textos de "a escola moveu"', () => {
  const fatos = {
    studentTz: 'America/Cuiaba',
    oldStartsUtc: ORIGINAL,
    newStartsUtc: NOVA,
    teacherName: 'Teacher Ana',
  }

  it('para o aluno: as mesmas palavras do WhatsApp, sem falar em desconto', () => {
    const e = teacherMovedEmail({ ...fatos, firstName: 'Marina' })
    expect(e.subject).toBe('Sua aula mudou de horário: 06/08 às 15:30')
    expect(e.html).toContain('Essa mudança partiu da escola: não usa suas remarcações do mês nem crédito.')
    expect(e.html).not.toContain('Como foi descontado')
  })

  it('para a professora (texto aprovado em 23/11/2026): no fuso DELA, sem dizer que o aluno remarcou', () => {
    const e = schoolMovedTeacherEmail({
      teacherName: 'Teacher Ana',
      studentName: 'Marina Souza',
      teacherTz: 'America/Sao_Paulo', // 1 h à frente de Cuiabá
      oldStartsUtc: ORIGINAL,
      newStartsUtc: NOVA,
    })
    expect(e.subject).toBe('Aula de Marina Souza remarcada pela escola: 06/08 às 16:30')
    expect(e.html).toContain('A administração remarcou a aula de <strong>Marina Souza</strong>')
    expect(e.html).toContain('04/08 às 15:00')
    expect(e.html).toContain('06/08 às 16:30')
    expect(e.html).toContain('Nenhuma ação necessária')
    expect(e.html).not.toContain('pelo portal')
  })

  it('o nome que vem do cadastro não vira HTML no e-mail da professora', () => {
    const e = schoolMovedTeacherEmail({
      teacherName: 'Ana <b>x</b>',
      studentName: 'Marina <script>',
      teacherTz: 'America/Cuiaba',
      oldStartsUtc: ORIGINAL,
      newStartsUtc: NOVA,
    })
    expect(e.html).not.toContain('<script>')
    expect(e.html).not.toContain('<b>x</b>')
  })
})
