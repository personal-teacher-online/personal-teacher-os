// M1 do cronograma — trilha-base por nível (migration 20260720000200): seed
// fiel dos Academic Plans da Flexge, leitura para logados, escrita nenhuma.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import { anonClient, clientAs, createAuthUser } from './helpers/auth'
import { connect } from './helpers/db'

let sql: Sql

beforeAll(async () => {
  sql = connect(2)
})
afterAll(async () => {
  await sql.end()
})

describe('seed das trilhas Flexge', () => {
  it('11 níveis, 71 módulos, posições sequenciais por trilha', async () => {
    const tracks = await sql`select level from curriculum_tracks`
    expect(tracks.map((t) => t.level).sort()).toEqual(
      ['A1', 'A1+', 'A2', 'A2+', 'B1', 'B1+', 'B2', 'B2+', 'C1', 'C2', 'Pre A1'].sort(),
    )
    const [{ n }] = await sql`select count(*)::int as n from curriculum_topics`
    expect(n).toBe(71)
    // posições 1..N sem buraco em cada trilha
    const gaps = await sql`
      select t.level from curriculum_tracks t
      join curriculum_topics c on c.track_id = t.id
      group by t.id, t.level
      having not (min(c.position) = 1
        and max(c.position) = count(*)
        and count(distinct c.position) = count(*))`
    expect(gaps).toHaveLength(0)
  })

  it('conteúdo fiel por amostra: Pre A1 módulo 1 e C2 com 8 módulos', async () => {
    const [m1] = await sql`
      select c.title, c.educational_goals from curriculum_topics c
      join curriculum_tracks t on t.id = c.track_id
      where t.level = 'Pre A1' and c.position = 1`
    expect(m1.title).toBe("Let's practice English!")
    expect(m1.educational_goals[0]).toBe('Teach the first words in English')
    const [c2] = await sql`
      select count(*)::int as n from curriculum_topics c
      join curriculum_tracks t on t.id = c.track_id where t.level = 'C2'`
    expect(c2.n).toBe(8) // detalhe manda (a página-resumo do PDF lista só 5 — defeito da fonte)
  })
})

describe('permissões', () => {
  it('logado de qualquer papel LÊ; anon vê vazio; ninguém escreve', async () => {
    const studentUser = await createAuthUser(sql, 'student', 'Aluno Currículo')
    const student = await clientAs(studentUser, 'student')
    const lida = await student.from('curriculum_tracks').select('level')
    expect(lida.data?.length).toBe(11)

    const anon = anonClient()
    const anonRead = await anon.from('curriculum_tracks').select('level')
    expect(anonRead.error).toBeNull()
    expect(anonRead.data).toEqual([])

    const escrita = await student.from('curriculum_topics').update({ title: 'x' }).eq('position', 1)
    expect(escrita.error?.code).toBe('42501')
  })
})
