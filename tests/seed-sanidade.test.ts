// Sanidade do seed depois da anonimização (Fase 2, passo 1b; ADR-039).
//
// O seed nasce público: nenhum nome de pessoa real, nenhum e-mail fora dos
// domínios fictícios. Os nomes reais NÃO entram aqui (seriam o próprio
// vazamento); o teste prende o que dá para prender sem eles: a equipe aparece
// pela marca ou por nome fictício, os 15 alunos continuam 15, e os fusos e horários
// que os testes de DST e de saldo usam são os mesmos de antes (Leis 1 e 2).
// Lê o ARQUIVO, não o banco: a bancada é compartilhada e acumula resíduo.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { avisarSemLista, nomesNoTexto, termosProibidos } from './helpers/nomes-proibidos'

const seed = readFileSync(new URL('../supabase/seed.sql', import.meta.url), 'utf8')

const DOMINIOS_PERMITIDOS = ['exemplo.com', 'local.dev', 'bancada.dev']
const EMAIL_INSTITUCIONAL = 'contato@personal-teacher.com'

/** Nomes de pessoa que o seed grava: alunos, rótulo do grupo e professoras. */
function nomesGravados(): string[] {
  const grupos = [...seed.matchAll(/insert into student_groups \(label\) values \('([^']+)'/g)].map((m) => m[1])
  return [...alunos().map(([nome]) => nome), ...grupos, ...professoras()]
}

function professoras(): string[] {
  return [...seed.matchAll(/insert into teachers \(([^)]*)\)\s*values \(([^;]*?)\)\s*returning/g)].map((m) => {
    const colunas = m[1].split(',').map((c) => c.trim())
    const valores = m[2].match(/'[^']*'|[^,\s][^,]*/g) ?? []
    return valores[colunas.indexOf('display_name')]?.replace(/^'|'$/g, '') ?? ''
  })
}

/**
 * O seed sem comentários e com cada nome trocado por `<nome>`: sobra só o que os
 * testes de DST, saldo e remarcação usam (fusos, horários, contratos, créditos,
 * aulas). Mudou o seed DE PROPÓSITO? Rode este teste, copie o hash que ele mostrar
 * em "Received" para `HASH_DO_SEED` e diga na PR o que mudou.
 */
function seedSemNomes(): string {
  let t = seed.replace(/\r/g, '').replace(/--[^\n]*/g, '')
  for (const nome of nomesGravados().sort((a, b) => b.length - a.length)) t = t.split(`'${nome}'`).join("'<nome>'")
  return t.replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n').trim()
}
const HASH_DO_SEED = '8522f50ca6ed37a347cdb9741e58f74713a272119f141acf158b949db49adfd6'

/** Alunos do seed: [nome, fuso], na ordem do arquivo. */
function alunos(): Array<[string, string]> {
  const particulares = [...seed.matchAll(/seed_private\(\s*v_\w+,\s*'([^']+)',\s*'([^']+)'/g)].map(
    (m) => [m[1], m[2]] as [string, string],
  )
  const avulsos = [
    ...seed.matchAll(/insert into students \(display_name, iana_tz, tz_confirmed\) values \('([^']+)', '([^']+)'/g),
  ].map((m) => [m[1], m[2]] as [string, string])
  return [...particulares, ...avulsos]
}

/**
 * Telefones de 10 a 13 dígitos (pontuação e espaço tirados; com ou sem "+") fora das faixas fictícias.
 * Datas AAAA-MM-DD saem do texto antes. Cada trecho de dígitos é lido em janelas deslizantes de
 * partes (separadas por espaço): a janela cresce até ter 10 dígitos (e no máximo 13), é julgada e
 * consumida; se a janela fictícia ou curta não fecha 10 dígitos, o início anda uma parte. Assim um
 * número com DDD separado, colado depois de um fictício, de um ano ou de outro número, é achado.
 * Limite conhecido: uma parte sozinha com mais de 13 dígitos (timestamp de migration, id) é
 * descartada, não julgada.
 */
function telefonesForaDaFaixa(texto: string): string[] {
  const achados: string[] = []
  const julga = (digitos: string) => {
    const ficticio =
      /^(55)?\d{2}(9000|99999)/.test(digitos) || /^1\d{3}55501/.test(digitos) || /^351900/.test(digitos)
    if (!ficticio) achados.push(digitos.slice(0, 4) + '***')
  }
  for (const m of texto.replace(/\d{4}-\d{2}-\d{2}/g, ' ').matchAll(/\+?\(?\d[\d\s().-]{8,}\d/g)) {
    const partes = m[0].split(/\s+/).map((parte) => parte.replace(/\D/g, '')).filter(Boolean)
    let inicio = 0
    while (inicio < partes.length) {
      let janela = ''
      let fim = inicio
      while (fim < partes.length && janela.length < 10 && janela.length + partes[fim].length <= 13) {
        janela += partes[fim]
        fim += 1
      }
      if (janela.length >= 10) {
        julga(janela)
        inicio = fim
      } else {
        inicio += 1
      }
    }
  }
  return achados
}

describe('seed sem dado real (passo 1b)', () => {
  it('a equipe aparece pela marca e por nome fictício, nunca pelo nome real', () => {
    expect(professoras()).toEqual(['Teacher Vicky', 'Renata'])
  })

  it('e-mail no seed só em domínio fictício ou o institucional', () => {
    const emails = [...seed.matchAll(/[A-Za-z0-9._+-]*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g)].map((m) => m[0])
    for (const email of emails) {
      const dominio = email.split('@')[1].toLowerCase()
      expect(email === EMAIL_INSTITUCIONAL || DOMINIOS_PERMITIDOS.includes(dominio), email).toBe(true)
    }
  })

  it('telefone no seed só nas faixas fictícias', () => {
    expect(telefonesForaDaFaixa(seed)).toEqual([])
  })

  it('a varredura de telefone pega número fora da faixa, com ou sem "+"', () => {
    const fora = ['9', '8765', '4321'].join('')
    expect(telefonesForaDaFaixa(`insert ... '(65) ${fora.slice(0, 5)}-${fora.slice(5)}'`)).toHaveLength(1)
    expect(telefonesForaDaFaixa(`'65${fora}'`)).toHaveLength(1)
    expect(telefonesForaDaFaixa(`'+55 65 ${fora}'`)).toHaveLength(1)
    expect(telefonesForaDaFaixa("'+5565900010001' e '65 90002-0002'")).toEqual([])
    expect(telefonesForaDaFaixa(`2026-07-12 65${fora}`)).toHaveLength(1)
    expect(telefonesForaDaFaixa(`65${fora} 65${fora}`)).toHaveLength(2)
    expect(telefonesForaDaFaixa(`5565900010001 65${fora}`)).toHaveLength(1)
    expect(telefonesForaDaFaixa('inicio 2026-07-12 17:00 fim')).toEqual([])
    expect(telefonesForaDaFaixa(`65 90001-0001 65 ${fora.slice(0, 5)}-${fora.slice(5)}`)).toHaveLength(1)
    expect(telefonesForaDaFaixa(`2026 65 ${fora.slice(0, 5)}-${fora.slice(5)}`)).toHaveLength(1)
    expect(telefonesForaDaFaixa('65 90001-0001 e 65 90002-0002')).toEqual([])
  })

  it('continua com 15 alunos, nomes distintos, e os mesmos fusos de antes', () => {
    const lista = alunos()
    expect(lista).toHaveLength(15)
    expect(new Set(lista.map(([nome]) => nome)).size).toBe(15)
    const porFuso = lista.reduce<Record<string, number>>((acc, [, tz]) => {
      acc[tz] = (acc[tz] ?? 0) + 1
      return acc
    }, {})
    expect(porFuso).toEqual({
      'America/Sao_Paulo': 4,
      'America/New_York': 1,
      'America/Cuiaba': 7,
      'America/Campo_Grande': 1,
      'America/Fortaleza': 1,
      'Europe/Lisbon': 1,
    })
  })

  it('nenhum nome nem e-mail do seed está na lista local de nomes reais', () => {
    const termos = termosProibidos()
    if (termos === null) return avisarSemLista('seed-sanidade')
    const emails = [...seed.matchAll(/[A-Za-z0-9._+-]*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g)].map((m) => m[0])
    expect(nomesNoTexto([...nomesGravados(), ...emails].join('\n'), termos)).toEqual([])
  })

  it('fusos, horários, contratos e créditos são os de antes (só os nomes mudaram)', () => {
    expect(createHash('sha256').update(seedSemNomes()).digest('hex')).toBe(HASH_DO_SEED)
  })

  // Prova só que o padrão do backfill casa com o nome gravado (prefixo); que ele
  // casa com UMA linha só é o `n <> 1` da própria migration que garante.
  it('o backfill da 20260713000100 casa com o nome que a 20260712000400 grava', () => {
    const grava = readFileSync(
      new URL('../supabase/migrations/20260712000400_fase2_views_rls_grants.sql', import.meta.url),
      'utf8',
    )
    const casa = readFileSync(new URL('../supabase/migrations/20260713000100_fase3_teacher_tz.sql', import.meta.url), 'utf8')
    const nome = /else '([^']+)' end/.exec(grava)?.[1]
    const padrao = /display_name ilike '([^']+)%'/.exec(casa)?.[1]
    expect(nome).toBe('Renata')
    expect(nome!.toLowerCase().startsWith(padrao!)).toBe(true)
    expect(seed).toContain(`'${nome}', 'America/Sao_Paulo')`)
  })
})
