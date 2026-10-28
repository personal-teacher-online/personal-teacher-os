// Onda Agenda e Mensagens · M2 (01/09/2026) — os textos dos avisos novos, PUROS
// (sem banco): o e-mail 3t ao aluno quando a professora remarcou, o aviso à
// professora quando outro cancela, o aviso interno à administração. E os dois
// pinos estruturais: só e-mail no despachante (linha de WhatsApp fica presa) e
// entrada no catálogo de mensagens (o teste do A8 compara as chaves).
import { describe, expect, it } from 'vitest'
import { CHAVES_DO_CATALOGO } from '../src/data/admin/ajustes-mensagens'
import { teacherMovedEmail } from '../src/lib/email/reschedule'
import { classCancelledTeacherEmail, teacherClassChangedEmail } from '../src/lib/email/teacher-notices'
import { TEMPLATES } from '../src/lib/outbox/dispatch'

// 2026-09-10 17:00Z = 13:00 em Cuiabá (UTC−4) = 14:00 em São Paulo (UTC−3)
const ANTIGA = '2026-09-10T17:00:00.000Z'
const NOVA = '2026-09-12T20:00:00.000Z' // 16:00 Cuiabá · 17:00 São Paulo

describe('e-mail 3t — a professora remarcou (aluno)', () => {
  it('diz que a mudança partiu da escola e que NADA foi descontado, no fuso do aluno', () => {
    const e = teacherMovedEmail({
      firstName: 'Marina',
      studentTz: 'America/Sao_Paulo',
      oldStartsUtc: ANTIGA,
      newStartsUtc: NOVA,
      teacherName: 'Teacher Vicky',
    })
    expect(e.subject).toBe('Sua aula mudou de horário: 12/09 às 17:00')
    expect(e.html).toContain('Oi, Marina!')
    expect(e.html).toContain('Teacher Vicky precisou remarcar')
    expect(e.html).toContain('10/09 às 14:00')
    expect(e.html).toContain('não usa suas remarcações do mês nem crédito')
    // o motivo da professora é da administração — nunca viaja para o aluno
    expect(e.html).not.toContain('Motivo')
  })
})

describe('aviso à professora — a aula dela foi cancelada por outra pessoa', () => {
  it('aluno cancelou: nomeia o aluno, no fuso DELA, sem falar de crédito', () => {
    const e = classCancelledTeacherEmail({
      firstName: 'Renata',
      studentName: 'Marina Costa',
      startsAtUtc: ANTIGA,
      teacherTz: 'America/Cuiaba',
      cancelledBy: 'student',
    })
    expect(e.subject).toContain('Aula com Marina Costa cancelada')
    expect(e.subject).toContain('10/09 às 13:00')
    expect(e.html).toContain('cancelou a aula pelo portal')
    expect(e.html).not.toContain('crédito')
    expect(e.html).toContain('/teacher?aba=aulas')
  })

  it('administração cancelou em nome da escola: diz que o aluno ganha crédito', () => {
    const e = classCancelledTeacherEmail({
      firstName: 'Renata',
      studentName: 'Marina Costa',
      startsAtUtc: ANTIGA,
      teacherTz: 'America/Sao_Paulo',
      cancelledBy: 'teacher',
    })
    expect(e.subject).toContain('10/09 às 14:00')
    expect(e.html).toContain('A administração cancelou')
    expect(e.html).toContain('ganha um crédito de reposição')
  })
})

describe('aviso interno à administração — a professora cancelou ou remarcou', () => {
  it('remarcação: saiu/entrou no fuso da professora, o motivo dela, nada descontado', () => {
    const e = teacherClassChangedEmail({
      firstName: 'Dona',
      teacherName: 'Renata',
      studentName: 'Marina Costa',
      kind: 'rescheduled',
      oldStartsAtUtc: ANTIGA,
      newStartsAtUtc: NOVA,
      reason: 'consulta médica no horário',
      teacherTz: 'America/Sao_Paulo',
    })
    expect(e.subject).toBe('Renata remarcou a aula de Marina Costa: sábado, 12/09 às 17:00')
    expect(e.html).toContain('Saiu:')
    expect(e.html).toContain('10/09 às 14:00')
    expect(e.html).toContain('Entrou:')
    expect(e.html).toContain('horário da professora')
    expect(e.html).toContain('consulta médica no horário')
    expect(e.html).toContain('Nada foi descontado do aluno')
    expect(e.html).toContain('/admin/agenda')
  })

  it('cancelamento: dito como falta da escola, com o crédito que o aluno ganhou', () => {
    const e = teacherClassChangedEmail({
      firstName: 'Dona',
      teacherName: 'Renata',
      studentName: 'Marina Costa',
      kind: 'cancelled',
      oldStartsAtUtc: ANTIGA,
      reason: 'ficou doente',
      teacherTz: 'America/Cuiaba',
      credited: true,
    })
    expect(e.subject).toBe('Renata cancelou a aula de Marina Costa (quinta-feira, 10/09 às 13:00)')
    expect(e.html).toContain('ficou doente')
    expect(e.html).toContain('ganhou um crédito de reposição')
    // o aviso ao aluno é dito como REGISTRADO, não como entregue
    expect(e.html).toContain('confira em Mensagens')
    expect(e.html).not.toContain('já foi avisado')
  })

  it('gate Sol · sem desfecho do crédito no aviso, o e-mail manda conferir — nunca afirma', () => {
    const e = teacherClassChangedEmail({
      firstName: 'Dona',
      teacherName: 'Renata',
      studentName: 'Marina Costa',
      kind: 'cancelled',
      oldStartsAtUtc: ANTIGA,
      reason: 'ficou doente',
      teacherTz: 'America/Cuiaba',
    })
    expect(e.html).not.toContain('ganhou um crédito')
    expect(e.html).not.toContain('não voltou sozinho')
    expect(e.html).toContain('Confira no saldo do aluno')
  })

  it('gate Sol · cancelamento SEM crédito (o banco devolveu credited = false) não afirma crédito', () => {
    const e = teacherClassChangedEmail({
      firstName: 'Dona',
      teacherName: 'Renata',
      studentName: 'Marina Costa',
      kind: 'cancelled',
      oldStartsAtUtc: ANTIGA,
      reason: 'ficou doente',
      teacherTz: 'America/Cuiaba',
      credited: false,
    })
    expect(e.html).not.toContain('ganhou um crédito')
    expect(e.html).toContain('não voltou sozinho')
  })

  it('gate Sol · cancelamento COM crédito diz a validade que o banco devolveu', () => {
    const e = teacherClassChangedEmail({
      firstName: 'Dona',
      teacherName: 'Renata',
      studentName: 'Marina Costa',
      kind: 'cancelled',
      oldStartsAtUtc: ANTIGA,
      reason: 'ficou doente',
      teacherTz: 'America/Cuiaba',
      credited: true,
      expiresOn: '2026-12-10',
    })
    expect(e.html).toContain('ganhou um crédito de reposição válido até 10/12/2026')
    expect(e.html).not.toContain('Entrou:')
  })

  it('escapa HTML vindo do motivo e dos nomes', () => {
    const e = teacherClassChangedEmail({
      firstName: 'Dona',
      teacherName: 'Prof <b>X</b>',
      studentName: 'A & B',
      kind: 'cancelled',
      oldStartsAtUtc: ANTIGA,
      reason: '<script>alert(1)</script>',
      teacherTz: 'America/Cuiaba',
    })
    expect(e.html).not.toContain('<script>')
    expect(e.html).toContain('&lt;script&gt;')
    expect(e.html).toContain('A &amp; B')
  })
})

describe('pinos estruturais do despachante e do catálogo', () => {
  it('os dois templates existem no registro, SÓ com e-mail (WhatsApp fica preso, como o aviso de troca de número)', () => {
    for (const chave of ['class-cancelled-teacher', 'teacher-class-changed']) {
      const spec = TEMPLATES[chave]
      expect(spec, chave).toBeDefined()
      expect(typeof spec.email).toBe('function')
      expect(spec.text).toBeUndefined()
      expect(spec.stale).toBeUndefined()
    }
  })

  it('o registro renderiza a partir do payload que a migration grava', () => {
    const cancel = TEMPLATES['class-cancelled-teacher'].email!(
      { student_name: 'Marina', starts_at_utc: ANTIGA, teacher_tz: 'America/Cuiaba', cancelled_by: 'student', via: 'self' },
      'Renata',
    )
    expect(cancel.subject).toContain('Marina')
    const mudou = TEMPLATES['teacher-class-changed'].email!(
      {
        kind: 'rescheduled',
        teacher_name: 'Renata',
        student_name: 'Marina',
        old_starts_at_utc: ANTIGA,
        new_starts_at_utc: NOVA,
        reason: 'x',
        teacher_tz: 'America/Cuiaba',
      },
      'Dona',
    )
    expect(mudou.subject).toContain('remarcou')
  })

  it('o catálogo de mensagens conhece as duas chaves (teste do A8 fecha a fresta oposta)', () => {
    expect(CHAVES_DO_CATALOGO).toContain('class-cancelled-teacher')
    expect(CHAVES_DO_CATALOGO).toContain('teacher-class-changed')
  })
})
