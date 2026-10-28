// ONDA DA AGENDA · LOTE FINAL — A TROCA DE WHATSAPP PELO ALUNO AVISA A
// PROFESSORA (migration 20260730000400, caso 12 do harness do A9).
//
// DECISÃO DO DONO (29/07, no goal): «o aluno continua podendo TROCAR o próprio
// WhatsApp no portal, mas a Teacher passa a ser avisada por e-mail quando isso
// acontece.» O número é canal de CONTRATO desde 28/07 — sem este aviso, a
// professora seguia com o número velho e a primeira notícia da troca era um
// recado que não chegou.
//
// O que este arquivo prova, contra o Postgres de verdade:
//   1. a troca enfileira UMA linha de e-mail por PROFESSORA DISTINTA dos
//      contratos ATIVOS do aluno — individuais e de grupo;
//   2. quem NÃO recebe: professora sem perfil (destinatário interno e
//      conhecido; linha órfã aqui seria resolvida pelo despachante como sendo
//      do ALUNO), contrato pausado/encerrado, e o segundo toque do mesmo dia
//      civil do NEGÓCIO (dedupe);
//   3. o UPDATE e a AUDITORIA continuam intactos — o enqueue é acréscimo, não
//      troca de comportamento (cada supressão vem com a prova de mutação do
//      caminho ligado ao lado; recusa sem caminho bom provado é recusa que pode
//      estar recusando tudo);
//   4. as provas ESTRUTURAIS: assinatura única (nada de overload — nesta
//      família overload é sorteio) e o template registrado SÓ como e-mail.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'

import { clientAs, createAuthUser } from './helpers/auth'
import { connect, createPrivateContract, createStudent } from './helpers/db'
import { definicaoDaFuncao, quemDefine } from './helpers/definicao-da-funcao'
import { TEMPLATES } from '@/lib/outbox/dispatch'

let sql: Sql

beforeAll(() => {
  sql = connect(5)
})
afterAll(async () => {
  await sql.end()
})

const TEMPLATE = 'student-whatsapp-changed'

/** Número E.164 único por chamada (o dedupe da fila é por chave, não por valor). */
let n = 0
function numeroNovo(): string {
  n += 1
  return '+55659000' + String(10000 + n)
}

/**
 * Um aluno COM login e o contrato particular ativo dele, com uma professora que
 * tem perfil (é o estado normal da escola: quem dá aula tem acesso ao painel).
 */
async function alunoComProfessora(opts: { professoraTemPerfil?: boolean } = {}) {
  const teacherProfile =
    opts.professoraTemPerfil === false ? null : await createAuthUser(sql, 'teacher', 'Profa. Teste')
  const c = await createPrivateContract(sql)
  if (teacherProfile)
    await sql`update teachers set profile_id = ${teacherProfile} where id = ${c.teacherId}`
  const userId = await createAuthUser(sql, 'student', 'Aluno da troca')
  await sql`update students set profile_id = ${userId} where id = ${c.studentId}`
  const student = await clientAs(userId, 'student')
  return { ...c, userId, teacherProfile, student }
}

/** As linhas do aviso DESTE aluno, com o que a professora vai ler. */
async function avisosDe(studentId: string) {
  return sql`
    select channel, recipient_profile_id, payload, dedupe_key, sent_at
      from notification_outbox
     where template = ${TEMPLATE} and payload->>'student_id' = ${studentId}::text
     order by dedupe_key`
}

/* ========================================================================== */
/* 1. O CAMINHO ABENÇOADO                                                      */
/* ========================================================================== */

describe('a troca de WhatsApp avisa a professora', () => {
  it('UMA linha de e-mail para a professora do contrato ativo, com o número NOVO', async () => {
    const a = await alunoComProfessora()
    const numero = numeroNovo()
    const r = await a.student.rpc('update_my_whatsapp', { p_e164: numero })
    expect(r.error).toBeNull()

    const linhas = await avisosDe(a.studentId)
    expect(linhas).toHaveLength(1)
    expect(linhas[0].channel).toBe('email')
    expect(linhas[0].recipient_profile_id).toBe(a.teacherProfile)
    expect(linhas[0].payload.whatsapp_e164).toBe(numero)
    expect(linhas[0].payload.teacher_id).toBe(a.teacherId)
    // O nome é o do ALUNO na ficha (`students.display_name`), que é como a
    // professora o conhece — não o `full_name` do perfil de acesso, que pode
    // estar em outra grafia (ou vazio).
    const [ficha] = await sql`select display_name from students where id = ${a.studentId}`
    expect(linhas[0].payload.student_name).toBe(ficha.display_name)

    // Lei 1: a chave do dedupe é o dia civil do NEGÓCIO, nunca `current_date`
    // (às 21h de Cuiabá o dia UTC já virou). E ela carrega o próprio E.164
    // (S2 da varredura final): é o que faz uma CORREÇÃO de número ser fato novo
    // em vez de repetição descartada.
    const [{ hoje }] = await sql`select public.business_today()::text as hoje`
    expect(linhas[0].dedupe_key).toBe(
      `student-wa-changed:${a.studentId}:${a.teacherId}:${hoje}:${numero}`,
    )

    // …e o ato principal continua acontecendo: o número mudou e a trilha existe.
    const [perfil] = await sql`select whatsapp_e164 from profiles where id = ${a.userId}`
    expect(perfil.whatsapp_e164).toBe(numero)
    const trilha = await sql`
      select 1 from audit_log where action = 'update_my_whatsapp' and entity_id = ${a.userId}::text`
    expect(trilha).toHaveLength(1)
  })

  it('o segundo toque do MESMO dia não vira segundo e-mail — mas troca o número', async () => {
    const a = await alunoComProfessora()
    await a.student.rpc('update_my_whatsapp', { p_e164: numeroNovo() })
    const segundo = numeroNovo()
    const r = await a.student.rpc('update_my_whatsapp', { p_e164: segundo })
    expect(r.error).toBeNull()

    const linhas = await avisosDe(a.studentId)
    expect(linhas).toHaveLength(1)
    // ⚠️ S2 DA VARREDURA FINAL, e é O defeito: com `do nothing` e a chave sem o
    // número, a linha que sobrava era a PRIMEIRA — a professora receberia o
    // número ERRADO, e o certo era descartado em silêncio.
    expect(linhas[0].payload.whatsapp_e164, 'o aviso ficou ensinando o número superado').toBe(
      segundo,
    )
    // PROVA DE MUTAÇÃO: o dedupe é do AVISO, não do update — quem corrige um
    // dígito errado tem o número certo no cadastro na mesma hora.
    const [perfil] = await sql`select whatsapp_e164 from profiles where id = ${a.userId}`
    expect(perfil.whatsapp_e164).toBe(segundo)
  })

  it('DUAS professoras distintas = dois avisos; a MESMA professora duas vezes = um', async () => {
    const a = await alunoComProfessora()
    // segundo contrato ativo do MESMO aluno com a MESMA professora (particular
    // + reforço): a professora não precisa saber duas vezes.
    await createPrivateContract(sql, { studentId: a.studentId, teacherId: a.teacherId })
    await a.student.rpc('update_my_whatsapp', { p_e164: numeroNovo() })
    expect(await avisosDe(a.studentId)).toHaveLength(1)

    // …e uma professora NOVA, com perfil, entra como segunda linha.
    const b = await alunoComProfessora()
    const outraProfa = await createAuthUser(sql, 'teacher', 'Profa. Dois')
    const outro = await createPrivateContract(sql, { studentId: b.studentId })
    await sql`update teachers set profile_id = ${outraProfa} where id = ${outro.teacherId}`
    await b.student.rpc('update_my_whatsapp', { p_e164: numeroNovo() })
    const linhas = await avisosDe(b.studentId)
    expect(linhas).toHaveLength(2)
    expect(linhas.map((l) => l.recipient_profile_id).sort()).toEqual(
      [b.teacherProfile, outraProfa].sort(),
    )
  })

  it('o aluno de CASAL/GRUPO também avisa a professora do grupo', async () => {
    // O aluno de um grupo é MEMBRO, não dono do contrato — sem o ramo de grupo
    // ele trocaria o número e ninguém saberia.
    const profa = await createAuthUser(sql, 'teacher', 'Profa. do casal')
    const c = await createPrivateContract(sql)
    await sql`update teachers set profile_id = ${profa} where id = ${c.teacherId}`
    const membro = await createStudent(sql)
    const userId = await createAuthUser(sql, 'student', 'Membro do casal')
    await sql`update students set profile_id = ${userId} where id = ${membro}`
    const [g] = await sql`insert into student_groups (label) values ('Casal do aviso') returning id`
    await sql`insert into student_group_members (group_id, student_id) values (${g.id}, ${membro})`
    await sql`
      insert into contracts
        (contract_type, student_group_id, teacher_id, plan_name, hourly_rate_cents,
         monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days, started_on)
      values ('private_1on1', ${g.id}, ${c.teacherId}, 'casal', 15000, 2, 24, 90,
              public.business_today())`

    const student = await clientAs(userId, 'student')
    const r = await student.rpc('update_my_whatsapp', { p_e164: numeroNovo() })
    expect(r.error).toBeNull()
    const linhas = await avisosDe(membro)
    expect(linhas).toHaveLength(1)
    expect(linhas[0].recipient_profile_id).toBe(profa)
  })
})

/* ========================================================================== */
/* 1b. A MATRIZ DO DEDUPE (S2) e o submit sem mudança (S3)                     */
/* ========================================================================== */

describe('varredura final · S2/S3 — o aviso nunca ensina um número superado', () => {
  /** Marca como DESPACHADA a linha que ainda não saiu (o que o worker faria). */
  async function despachar(studentId: string) {
    const r = await sql`
      update notification_outbox
         set sent_at = now()
       where template = ${TEMPLATE} and payload->>'student_id' = ${studentId}::text
         and sent_at is null`
    expect(r.count, 'não havia aviso pendente para despachar').toBeGreaterThan(0)
  }

  it('PENDENTE + correção: a linha velha MORRE e sobra uma só, com o número novo', async () => {
    const a = await alunoComProfessora()
    const errado = numeroNovo()
    const certo = numeroNovo()
    await a.student.rpc('update_my_whatsapp', { p_e164: errado })
    await a.student.rpc('update_my_whatsapp', { p_e164: certo })

    const linhas = await avisosDe(a.studentId)
    expect(linhas, 'a professora receberia DOIS e-mails, um com o número errado').toHaveLength(1)
    expect(linhas[0].payload.whatsapp_e164).toBe(certo)
    expect(linhas[0].sent_at).toBeNull()
  })

  it('DESPACHADA + correção: o aviso do número certo NASCE (a professora precisa saber)', async () => {
    const a = await alunoComProfessora()
    const errado = numeroNovo()
    const certo = numeroNovo()
    await a.student.rpc('update_my_whatsapp', { p_e164: errado })
    await despachar(a.studentId)

    await a.student.rpc('update_my_whatsapp', { p_e164: certo })
    const linhas = await avisosDe(a.studentId)
    // duas linhas: a que JÁ SAIU (intocada — reescrevê-la apagaria o rastro do
    // que foi enviado) e a correção, pendente.
    expect(linhas, 'a correção não nasceu: a professora ficou com o número errado').toHaveLength(2)
    const enviada = linhas.find((l) => l.sent_at !== null)!
    const nova = linhas.find((l) => l.sent_at === null)!
    expect(enviada.payload.whatsapp_e164).toBe(errado)
    expect(nova.payload.whatsapp_e164).toBe(certo)
    expect(nova.dedupe_key).toContain(certo)
  })

  it('REPETIÇÃO IDÊNTICA colapsa — pendente e também depois de despachada', async () => {
    const a = await alunoComProfessora()
    const numero = numeroNovo()
    await a.student.rpc('update_my_whatsapp', { p_e164: numero })
    // o aluno abre a tela de novo e reenvia o MESMO número (S3): nada nasce
    await a.student.rpc('update_my_whatsapp', { p_e164: numero })
    expect(await avisosDe(a.studentId)).toHaveLength(1)

    // …e depois de o e-mail já ter saído, o mesmo número também não renasce:
    // nada mudou desde o aviso que ela recebeu.
    await despachar(a.studentId)
    await a.student.rpc('update_my_whatsapp', { p_e164: numero })
    const linhas = await avisosDe(a.studentId)
    expect(linhas).toHaveLength(1)
    expect(linhas[0].sent_at).not.toBeNull()
  })

  it('S3 · submit SEM MUDANÇA não enfileira — e o update/auditoria continuam (declarado)', async () => {
    const a = await alunoComProfessora()
    const numero = numeroNovo()
    await a.student.rpc('update_my_whatsapp', { p_e164: numero })
    await despachar(a.studentId)

    const r = await a.student.rpc('update_my_whatsapp', { p_e164: numero })
    expect(r.error).toBeNull()
    // o aviso é o que se suprime…
    expect(await avisosDe(a.studentId)).toHaveLength(1)
    // …o número gravado continua o mesmo, e a trilha registra os DOIS toques
    // (é a escolha declarada no cabeçalho da migration: suprimir a auditoria
    // esconderia que o aluno mexeu no campo).
    const [perfil] = await sql`select whatsapp_e164 from profiles where id = ${a.userId}`
    expect(perfil.whatsapp_e164).toBe(numero)
    const trilha = await sql`
      select 1 from audit_log where action = 'update_my_whatsapp' and entity_id = ${a.userId}::text`
    expect(trilha).toHaveLength(2)
  })

  it('o PRIMEIRO número de um perfil que não tinha nenhum é mudança e avisa', async () => {
    // `is distinct from` e não `<>`: com NULL do lado esquerdo, o `<>` devolve
    // NULL e o `if` cairia no ramo do "não mudou" — a professora nunca saberia
    // que o aluno passou a ter WhatsApp.
    const a = await alunoComProfessora()
    await sql`update profiles set whatsapp_e164 = null where id = ${a.userId}`
    const numero = numeroNovo()
    await a.student.rpc('update_my_whatsapp', { p_e164: numero })
    const linhas = await avisosDe(a.studentId)
    expect(linhas).toHaveLength(1)
    expect(linhas[0].payload.whatsapp_e164).toBe(numero)
  })
})

/* ========================================================================== */
/* 2. QUEM NÃO RECEBE — e a prova de que o caminho ligado continua ligado      */
/* ========================================================================== */

describe('quem NÃO é avisado (e o número muda do mesmo jeito)', () => {
  it('professora SEM perfil é pulada — não nasce linha sem destinatário', async () => {
    // O oposto da decisão da linha órfã de `_enqueue_class_cancelled`, e de
    // propósito: lá o destinatário é o ALUNO (que ganha login depois e o
    // despachante resolve tarde). Aqui, uma linha sem `recipient_profile_id`
    // seria resolvida por `payload.student_id` — e o despachante mandaria à
    // ALUNA um e-mail interno sobre ela mesma.
    const a = await alunoComProfessora({ professoraTemPerfil: false })
    const numero = numeroNovo()
    const r = await a.student.rpc('update_my_whatsapp', { p_e164: numero })
    expect(r.error).toBeNull()
    expect(await avisosDe(a.studentId)).toHaveLength(0)
    const [perfil] = await sql`select whatsapp_e164 from profiles where id = ${a.userId}`
    expect(perfil.whatsapp_e164).toBe(numero)
  })

  it('contrato PAUSADO ou ENCERRADO não avisa', async () => {
    for (const status of ['paused', 'ended']) {
      const a = await alunoComProfessora()
      await sql`update contracts set status = ${status} where id = ${a.contractId}`
      const r = await a.student.rpc('update_my_whatsapp', { p_e164: numeroNovo() })
      expect(r.error, status).toBeNull()
      expect(await avisosDe(a.studentId), status).toHaveLength(0)
    }
    // PROVA DE MUTAÇÃO: com o contrato ATIVO, a mesma troca avisa.
    const viva = await alunoComProfessora()
    await viva.student.rpc('update_my_whatsapp', { p_e164: numeroNovo() })
    expect(await avisosDe(viva.studentId)).toHaveLength(1)
  })

  it('conta autenticada que não é ficha de aluno troca o número sem avisar ninguém', async () => {
    // Admin trocando o próprio número: não há professora a avisar, e a RPC não
    // pode estourar por isso.
    const adminId = await createAuthUser(sql, 'admin', 'Admin da troca', {
      whatsapp: '+5565900000010',
    })
    const admin = await clientAs(adminId, 'admin')
    const numero = numeroNovo()
    const r = await admin.rpc('update_my_whatsapp', { p_e164: numero })
    expect(r.error).toBeNull()
    const [perfil] = await sql`select whatsapp_e164 from profiles where id = ${adminId}`
    expect(perfil.whatsapp_e164).toBe(numero)
  })

  it('as recusas de sempre continuam de pé — e recusa não enfileira nada', async () => {
    const a = await alunoComProfessora()
    const antes = (await sql`select whatsapp_e164 from profiles where id = ${a.userId}`)[0]
    for (const ruim of ['', '   ', 'abc', '5565999999999']) {
      const r = await a.student.rpc('update_my_whatsapp', { p_e164: ruim })
      expect(r.error, ruim).not.toBeNull()
    }
    expect(await avisosDe(a.studentId)).toHaveLength(0)
    const depois = (await sql`select whatsapp_e164 from profiles where id = ${a.userId}`)[0]
    expect(depois.whatsapp_e164).toBe(antes.whatsapp_e164)
  })
})

/* ========================================================================== */
/* 3. ESTRUTURA — a assinatura não mudou, e o template é SÓ e-mail             */
/* ========================================================================== */

describe('estrutura da migration e do template', () => {
  it('a definição EFETIVA vem da migration nova, com a assinatura INTOCADA', () => {
    // `definicaoDaFuncao` ESTOURA com duas assinaturas vivas — é a guarda
    // contra o `create or replace` que criaria overload em vez de trocar o
    // corpo. Que ela devolva a migration nova prova as duas coisas: a
    // assinatura é a MESMA da 95 (senão seriam duas vivas) e quem vale agora é
    // esta. Se a assinatura mudasse, os `revoke`/`grant` de lá deixariam de
    // valer — a ACL viaja com a assinatura, não com o nome (lição do A6/lote 2).
    const d = definicaoDaFuncao('update_my_whatsapp')
    expect(d.origem).toBe('20260730000400_aviso_troca_whatsapp.sql')
    // A função nasceu na F7 e foi reescrita na 95 (o WhatsApp virou canal de
    // contrato); a NOSSA é a última da fila, que é a que vale depois de aplicar
    // tudo. As anteriores continuam onde estão — migration é imutável (Lei 7).
    const cadeia = quemDefine('update_my_whatsapp')
    expect(cadeia.at(-1)).toBe('20260730000400_aviso_troca_whatsapp.sql')
    expect(cadeia).toContain('20260728001000_whatsapp_do_contrato.sql')
    // `create or replace` (nunca `drop`) e o mesmo parâmetro de sempre.
    expect(d.corpo).toContain('create or replace function public.update_my_whatsapp(p_e164 text)')
  })

  it('o corpo da 95 sobreviveu VERBATIM — o enqueue é acréscimo, não reescrita', () => {
    const corpo = definicaoDaFuncao('update_my_whatsapp').corpo
    for (const pedaco of [
      "raise exception 'sessão necessária'",
      "raise exception 'whatsapp-obrigatorio'",
      "if v_clean !~ '^\\+[1-9]\\d{9,14}$' then",
      'update profiles set whatsapp_e164 = v_clean where id = auth.uid()',
      "raise exception 'perfil não encontrado para esta conta'",
      "perform public.log_audit(auth.uid(), 'update_my_whatsapp'",
    ])
      expect(corpo, pedaco).toContain(pedaco)
    // SECURITY DEFINER com search_path fechado — a régua de toda RPC da casa.
    expect(corpo).toContain('security definer')
    expect(corpo).toContain('set search_path = public, pg_temp')
    // …e o insert continua idempotente, como toda a família do outbox — agora
    // com o `do update` que reescreve SÓ a linha que ainda não saiu (S2). A
    // guarda `sent_at is null` é a que impede o aviso já enviado de ser
    // reescrito por baixo do rastro.
    expect(corpo).toContain('on conflict (dedupe_key) do update')
    expect(corpo).toContain('where notification_outbox.sent_at is null')
  })

  it('o template é SÓ E-MAIL: avisar pelo canal que mudou seria o defeito', () => {
    const spec = TEMPLATES[TEMPLATE]
    expect(spec, 'template sem handler no despachante').toBeTruthy()
    expect(typeof spec.email).toBe('function')
    expect(spec.text, 'uma versão WhatsApp mandaria o aviso pelo número que acabou de mudar')
      .toBeUndefined()
    const { subject, html } = spec.email!(
      { student_name: 'Marina', whatsapp_e164: '+5565900090009' },
      'Dona',
    )
    expect(subject).toContain('Marina')
    expect(html).toContain('+5565900090009')
    expect(html).toContain('Dona')
  })
})
