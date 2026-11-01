// #115, exigência do dono no ponto 3: quando o link da sala não é do Google
// Meet, o toque de 2 h sai SEM o botão de sala e o botão "Confirmar presença"
// leva a aluna à página da aula. Então a página da aula (`/portal/aula/<id>`)
// tem de mostrar o link da sala — o da aula e, sem ele, o link reserva da
// professora —, inclusive quando ele não é do Meet. Aqui se prova pela leitura
// REAL da página (`aulaDoAluno`, com o cliente da aluna sob RLS) e pelo pino
// de que a página entrega esse link ao botão de entrar.
import { readFileSync } from 'node:fs'
import path from 'node:path'

import type { Sql } from 'postgres'
import { DateTime } from 'luxon'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { aulaDoAluno } from '@/lib/portal/data'
import { clientAs, createAuthUser } from './helpers/auth'
import { connect, createInstanceAt, createPrivateContract } from './helpers/db'

let sql: Sql

beforeAll(() => {
  sql = connect(2)
})
afterAll(async () => {
  await sql.end()
})

async function cenario() {
  const c = await createPrivateContract(sql)
  const userId = await createAuthUser(sql, 'student', 'Aluna sala')
  await sql`update students set profile_id = ${userId} where id = ${c.studentId}`
  const inicio = DateTime.utc().plus({ hours: 2 }).startOf('minute').toISO()!
  const aula = await createInstanceAt(sql, c, inicio)
  return { ...c, aula, client: await clientAs(userId, 'student') }
}

describe('#115 · a página da aula mostra o link da sala', () => {
  it('sem link na aula, mostra o link reserva da professora, mesmo fora do Meet', async () => {
    const s = await cenario()
    await sql`update teachers set fallback_meet_url = 'https://zoom.exemplo.com/j/sala-fixa' where id = ${s.teacherId}`
    const { dado, erro } = await aulaDoAluno(s.client, s.aula)
    expect(erro).toBe(false)
    expect(dado?.meetUrl).toBe('https://zoom.exemplo.com/j/sala-fixa')
  })

  it('com link na aula, é ele que aparece', async () => {
    const s = await cenario()
    await sql`update teachers set fallback_meet_url = 'https://zoom.exemplo.com/j/sala-fixa' where id = ${s.teacherId}`
    await sql`update class_instances set meet_url = 'https://zoom.exemplo.com/j/da-aula' where id = ${s.aula}`
    const { dado } = await aulaDoAluno(s.client, s.aula)
    expect(dado?.meetUrl).toBe('https://zoom.exemplo.com/j/da-aula')
  })

  it('pino: a página entrega esse link ao botão de entrar', () => {
    const pagina = readFileSync(path.resolve(__dirname, '../src/app/portal/aula/[instance]/page.tsx'), 'utf8')
    expect(pagina).toContain('aulaDoAluno(supabase, instance)')
    expect(pagina).toMatch(/<BotaoEntrar[\s\S]*?meetUrl=\{dados\.meetUrl\}/)
  })
})
