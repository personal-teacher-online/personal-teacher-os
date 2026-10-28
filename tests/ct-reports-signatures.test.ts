// Construção total — relatórios de progresso (20260715000300: via única
// draft → approved → sent por trigger, RLS admin/professora) e assinaturas
// Autentique (20260715000400: matriz de transição monotônica SÓ via RPC).
// Fixtures PRÓPRIAS; teste-pino de permissão: expect(error?.code).toBe('42501').
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clientAs, createAuthUser, serviceClient } from './helpers/auth'
import { connect, createPrivateContract, createStudent, createTeacher } from './helpers/db'

let sql: Sql
let service: SupabaseClient
let adminId: string
let admin: SupabaseClient

beforeAll(async () => {
  sql = connect(3)
  service = serviceClient()
  adminId = await createAuthUser(sql, 'admin', 'Admin relatórios CT')
  admin = await clientAs(adminId, 'admin')
})
afterAll(async () => {
  await sql.end()
})

describe('progress_reports — via única draft → approved → sent', () => {
  async function insertDraft(studentId: string) {
    const { data, error } = await admin
      .from('progress_reports')
      .insert({
        student_id: studentId,
        period_start: '2026-06-01',
        period_end: '2026-06-30',
        content_md: 'Rascunho do Claude',
        created_by: adminId,
      })
      .select('id, status')
      .single()
    expect(error).toBeNull()
    return data!.id as string
  }

  it('nasce SEMPRE draft: INSERT approved recusado; draft entra e aceita edição', async () => {
    const studentId = await createStudent(sql)

    const nascePronto = await admin.from('progress_reports').insert({
      student_id: studentId,
      period_start: '2026-06-01',
      period_end: '2026-06-30',
      status: 'approved',
      approved_by: adminId,
      approved_at: new Date().toISOString(),
    })
    expect(nascePronto.error?.message).toMatch(/nasce como RASCUNHO/)

    const id = await insertDraft(studentId)
    const edit = await admin
      .from('progress_reports')
      .update({ content_md: 'Rascunho revisado pela dona' })
      .eq('id', id)
      .select('content_md')
      .single()
    expect(edit.error).toBeNull()
    expect(edit.data!.content_md).toBe('Rascunho revisado pela dona')
  })

  it('draft→sent direto é barrado; aprovado congela conteúdo mas aceita artefatos; sent é imutável', async () => {
    const studentId = await createStudent(sql)
    const id = await insertDraft(studentId)

    const pulaEtapa = await admin
      .from('progress_reports')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', id)
    expect(pulaEtapa.error?.message).toMatch(/precisa ser APROVADO/)

    const aprova = await admin
      .from('progress_reports')
      .update({
        status: 'approved',
        approved_by: adminId,
        approved_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('status')
      .single()
    expect(aprova.error).toBeNull()
    expect(aprova.data!.status).toBe('approved')

    // congelado: conteúdo não anda mais (whitelist do painel, achado 26)
    const mexeConteudo = await admin
      .from('progress_reports')
      .update({ content_md: 'edição tardia' })
      .eq('id', id)
    expect(mexeConteudo.error?.message).toMatch(/congelado/)

    // ...mas os PONTEIROS de artefato andam (Slides gerado pós-aprovação)
    const slides = await admin
      .from('progress_reports')
      .update({ slides_file_id: 'drive-slides-ct-1' })
      .eq('id', id)
      .select('slides_file_id')
      .single()
    expect(slides.error).toBeNull()
    expect(slides.data!.slides_file_id).toBe('drive-slides-ct-1')

    const envia = await admin
      .from('progress_reports')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', id)
      .select('status')
      .single()
    expect(envia.error).toBeNull()
    expect(envia.data!.status).toBe('sent')

    const mexeEnviado = await admin
      .from('progress_reports')
      .update({ title: 'renomeio pós-envio' })
      .eq('id', id)
    expect(mexeEnviado.error?.message).toMatch(/imutável/)

    const apaga = await admin.from('progress_reports').delete().eq('id', id)
    expect(apaga.error?.message).toMatch(/não se apaga/)
    const [ainda] = await sql`select status from progress_reports where id = ${id}`
    expect(ainda.status).toBe('sent')
  })

  it('RLS: aluno lê zero; professora lê só o relatório do PRÓPRIO aluno', async () => {
    // Professora com login + contrato com o aluno A; aluno B é de outra professora.
    const own = await createPrivateContract(sql)
    const teacherUser = await createAuthUser(sql, 'teacher', 'Professora relatórios CT')
    await sql`update teachers set profile_id = ${teacherUser} where id = ${own.teacherId}`
    const alien = await createPrivateContract(sql)

    const [rOwn] = await sql`
      insert into progress_reports (student_id, contract_id, period_start, period_end, content_md)
      values (${own.studentId}, ${own.contractId}, '2026-06-01', '2026-06-30', 'do meu aluno')
      returning id`
    const [rAlien] = await sql`
      insert into progress_reports (student_id, contract_id, period_start, period_end, content_md)
      values (${alien.studentId}, ${alien.contractId}, '2026-06-01', '2026-06-30', 'de aluno alheio')
      returning id`

    const teacher = await clientAs(teacherUser, 'teacher')
    const mine = await teacher
      .from('progress_reports')
      .select('id')
      .in('id', [rOwn.id, rAlien.id])
    expect(mine.error).toBeNull()
    expect(mine.data).toHaveLength(1)
    expect(mine.data![0].id).toBe(rOwn.id)

    const student = await clientAs(await createAuthUser(sql, 'student', 'Aluno relatórios CT'), 'student')
    const zero = await student
      .from('progress_reports')
      .select('id')
      .in('id', [rOwn.id, rAlien.id])
    expect(zero.error).toBeNull()
    expect(zero.data).toHaveLength(0)
  })
})

describe('contract_signatures — envio pela RPC de reserva; transição SÓ pela RPC', () => {
  /**
   * c14 · Sol 2.1 — O ESPELHO NASCE PELA RESERVA, e não por um INSERT direto.
   *
   * Este helper era `admin.from('contract_signatures').insert(...)`. A porta
   * fechou (a admin não tem mais INSERT na tabela — migration 20260727001400),
   * e o que ele prova continua o mesmo: a admin ENVIA e o espelho nasce em
   * `sent`. Só que agora em dois atos, que é o desenho — a reserva `pending`
   * existe ANTES da chamada externa, e o id do documento é anexado depois.
   */
  async function insertSignature() {
    const c = await createPrivateContract(sql)
    const doc = 'ct-doc-' + crypto.randomUUID().replace(/-/g, '')
    const reserva = await admin.rpc('admin_begin_signature', { p_contract: c.contractId })
    expect(reserva.error).toBeNull()
    const [reservada] = await sql<{ status: string; provider_document_id: string | null }[]>`
      select status, provider_document_id from contract_signatures where id = ${reserva.data as string}`
    expect(reservada.status).toBe('pending')
    expect(reservada.provider_document_id).toBeNull()

    const fim = await admin.rpc('admin_finish_signature', {
      p_signature: reserva.data as string,
      p_document_id: doc,
    })
    expect(fim.error).toBeNull()
    expect(fim.data).toBe('sent')
    return { sigId: reserva.data as string, doc, contractId: c.contractId }
  }

  it('admin envia pela RPC; INSERT e UPDATE diretos — admin E service — caem no pino 42501', async () => {
    const { sigId } = await insertSignature()

    // c14: o INSERT direto da admin morreu junto com o `grant insert`.
    const insertDireto = await admin
      .from('contract_signatures')
      .insert({ contract_id: (await createPrivateContract(sql)).contractId, provider_document_id: 'x' })
    expect(insertDireto.error?.code).toBe('42501')

    const viaAdmin = await admin
      .from('contract_signatures')
      .update({ status: 'viewed' })
      .eq('id', sigId)
    expect(viaAdmin.error?.code).toBe('42501')

    const viaService = await service
      .from('contract_signatures')
      .update({ status: 'viewed' })
      .eq('id', sigId)
    expect(viaService.error?.code).toBe('42501') // escrita do webhook é SÓ pela RPC definer

    // UNIQUE (provider, provider_document_id) continua de pé: o mesmo documento
    // não se espelha duas vezes, agora pela porta nova.
    const outro = await createPrivateContract(sql)
    const reserva = await admin.rpc('admin_begin_signature', { p_contract: outro.contractId })
    expect(reserva.error).toBeNull()
    const dup = await admin.rpc('admin_finish_signature', {
      p_signature: reserva.data as string,
      p_document_id: (
        await sql`select provider_document_id from contract_signatures where id = ${sigId}`
      )[0].provider_document_id,
    })
    expect(dup.error?.code).toBe('23505')
  })

  it('apply_autentique_event: sent→viewed→signed audita; replay é monotônico; doc inexistente → null', async () => {
    const { sigId, doc } = await insertSignature()

    const viewed = await service.rpc('apply_autentique_event', {
      p_provider_document_id: doc,
      p_new_status: 'viewed',
    })
    expect(viewed.error).toBeNull()
    expect(viewed.data).toBe('viewed')

    const signed = await service.rpc('apply_autentique_event', {
      p_provider_document_id: doc,
      p_new_status: 'signed',
      p_event: { event: 'signature.accepted' },
    })
    expect(signed.error).toBeNull()
    expect(signed.data).toBe('signed')

    const [row] = await sql`
      select status, signed_at, last_event from contract_signatures where id = ${sigId}`
    expect(row.status).toBe('signed')
    expect(row.signed_at).not.toBeNull()
    expect(row.last_event.event).toBe('signature.accepted')

    const audits = await sql`
      select diff from audit_log
      where action = 'apply_autentique_event' and entity_id = ${sigId}::text
      order by id`
    expect(audits).toHaveLength(2)
    expect(audits[0].diff).toMatchObject({ from: 'sent', to: 'viewed' })
    expect(audits[1].diff).toMatchObject({ from: 'viewed', to: 'signed' })

    // Replay atrasado de 'viewed' após signed: devolve o vigente, linha intacta.
    const replay = await service.rpc('apply_autentique_event', {
      p_provider_document_id: doc,
      p_new_status: 'viewed',
    })
    expect(replay.error).toBeNull()
    expect(replay.data).toBe('signed')
    const [after] = await sql`
      select status, signed_at from contract_signatures where id = ${sigId}`
    expect(after.status).toBe('signed')
    expect(new Date(after.signed_at).getTime()).toBe(new Date(row.signed_at).getTime())
    expect(
      await sql`select id from audit_log
                where action = 'apply_autentique_event' and entity_id = ${sigId}::text`,
    ).toHaveLength(2) // replay não audita transição — nada mudou

    const ghost = await service.rpc('apply_autentique_event', {
      p_provider_document_id: 'ct-doc-inexistente-' + crypto.randomUUID(),
      p_new_status: 'viewed',
    })
    expect(ghost.error).toBeNull()
    expect(ghost.data).toBeNull() // rastro fica na inbox do chamador
  })

  it('pino 42501: authenticated (mesmo admin) não executa a RPC de webhook', async () => {
    const { doc } = await insertSignature()
    const viaAdmin = await admin.rpc('apply_autentique_event', {
      p_provider_document_id: doc,
      p_new_status: 'viewed',
    })
    expect(viaAdmin.error?.code).toBe('42501')
  })
})

/* ========================================================================== */
/* Sol r8 nº 1 — o gerador de Slides só aceita APPROVED                        */
/* ========================================================================== */
//
// A UI só mostra o botão no aprovado, mas Server Action é porta POST direta
// (aba velha aberta): sem o cinto, um relatório já `sent` re-copiava o deck no
// Google e o arquivo ficava órfão quando o update local recusasse. O trigger
// de imutabilidade do `sent` está provado acima; aqui se prova que a ACTION
// recusa ANTES de tocar o Google.
describe('generateSlidesAction — cinto de estado (Sol r8 nº 1)', () => {
  it('recusa draft E qualquer estado ≠ approved antes da cópia externa', () => {
    const fonte = readFileSync(
      path.join(__dirname, '..', 'src/app/admin/relatorios/actions.ts'),
      'utf8',
    )
    const guarda = fonte.indexOf("status !== 'approved'")
    // `indexOf` simples acharia o IMPORT lá no topo; o que importa é a CHAMADA
    const copia = fonte.indexOf('generateDeckFromTemplate({')
    expect(guarda, 'o cinto existe').toBeGreaterThan(-1)
    expect(copia, 'a cópia externa existe').toBeGreaterThan(-1)
    expect(guarda, 'e o cinto vem ANTES da cópia').toBeLessThan(copia)
    expect(fonte).toContain('não é regerado depois do envio')
  })
})
