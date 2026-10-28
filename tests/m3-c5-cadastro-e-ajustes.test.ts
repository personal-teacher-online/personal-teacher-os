// M3-c5 — as decisões marteladas pelo dono (campos novos do aluno, plano
// selecionável fase 1, Ajustes no menu da conta) + as antecipações baratas da
// auditoria B6.
//
// O que este arquivo prova, e onde:
//  · D1 — a NOTA INTERNA cumpre no BANCO a promessa que a tela faz ("nunca
//    para o aluno"): RLS de verdade, pelo PostgREST, com JWT de cada papel; a
//    RPC é a única porta de escrita, tem gate de papel e AUDITA; e os campos
//    novos entram na anonimização (dado pessoal que sobrevive ao esquecimento
//    é vazamento com data marcada);
//  · D2 — a lista de planos é derivada, distinta e ordenada (parte pura);
//  · D3 — o Ajustes mudou de casa sem perder o acesso móvel (grep de estrutura,
//    porque não há harness de DOM no repo);
//  · D4 — as seis antecipações da B6: cada uma existe no lugar onde a pessoa
//    erraria, e nenhuma inventou regra que o banco não tenha.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Sql } from 'postgres'

import { clientAs, createAuthUser } from './helpers/auth'
import { connect } from './helpers/db'
import { faixaLocal } from '@/components/CountryPhoneField'
import { PLANO_OUTRO, PLANO_PADRAO, planoInicial, planosDoSeletor } from '@/data/admin/admissao'
import {
  ExtrasDoAlunoSchema,
  TIPO_DE_ALUNO,
  TIPO_PADRAO,
  tipoDeAlunoValido,
} from '@/data/admin/ficha-gramatica'

const RAIZ = path.resolve(__dirname, '..')
const corpo = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8')
/** Código SEM comentários: comentário conta o que MORREU; o que vale é o código. */
const codigo = (rel: string) =>
  corpo(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

/* ========================================================================== */
/* D1 — a nota interna, no banco                                               */
/* ========================================================================== */

describe('D1 · nota interna: RLS, RPC e anonimização', () => {
  let sql: Sql
  let adminUser: string
  let teacherUser: string
  let outraUser: string
  let studentUser: string
  let studentId: string
  let teacherId: string

  beforeAll(async () => {
    sql = connect(3)
    adminUser = await createAuthUser(sql, 'admin', 'Dona (admin) c5')
    teacherUser = await createAuthUser(sql, 'teacher', 'Professora do aluno c5')
    outraUser = await createAuthUser(sql, 'teacher', 'Professora de fora c5')
    studentUser = await createAuthUser(sql, 'student', 'Aluno c5')

    const [t] = await sql`
      insert into teachers (profile_id, hourly_rate_cents) values (${teacherUser}, 5000) returning id`
    teacherId = t.id
    await sql`insert into teachers (profile_id, hourly_rate_cents) values (${outraUser}, 5000)`

    const [s] = await sql`
      insert into students (profile_id, display_name, iana_tz, tz_confirmed)
      values (${studentUser}, 'Aluno c5', 'America/Cuiaba', true) returning id`
    studentId = s.id
    await sql`
      insert into contracts
        (contract_type, student_id, teacher_id, plan_name, hourly_rate_cents,
         monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days, started_on)
      values ('private_1on1', ${studentId}, ${teacherId}, 'c5', 15000, 4, 24, 90,
              public.business_today())`
  })

  afterAll(async () => {
    await sql?.end()
  })

  it('o ALUNO nunca lê a própria nota — nem a de ninguém (o ponto da tabela)', async () => {
    await sql`
      insert into student_notes (student_id, note) values (${studentId}, 'mãe acompanha as remarcações')
      on conflict (student_id) do update set note = excluded.note`

    const comoAluno = await clientAs(studentUser, 'student')
    const { data, error } = await comoAluno.from('student_notes').select('note')
    // Negar por padrão não é erro: é lista vazia. O que não pode existir é a
    // linha aparecendo — e é ISSO que faz a nota não ser coluna de `students`,
    // que o portal lê inteira pela `students_self`.
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('a admin lê; a professora lê só a dos alunos DELA', async () => {
    const comoAdmin = await clientAs(adminUser, 'admin')
    const daAdmin = await comoAdmin.from('student_notes').select('note').eq('student_id', studentId)
    expect(daAdmin.error).toBeNull()
    expect(daAdmin.data?.[0]?.note).toContain('mãe acompanha')

    const comoDela = await clientAs(teacherUser, 'teacher')
    const dela = await comoDela.from('student_notes').select('note').eq('student_id', studentId)
    expect(dela.data).toHaveLength(1)

    const comoOutra = await clientAs(outraUser, 'teacher')
    const deFora = await comoOutra.from('student_notes').select('note').eq('student_id', studentId)
    expect(deFora.data).toEqual([])
  })

  it('ninguém escreve na tabela por fora da RPC — nem o service_role (Lei 3)', async () => {
    const comoAdmin = await clientAs(adminUser, 'admin')
    const direto = await comoAdmin
      .from('student_notes')
      .update({ note: 'escrita por fora' })
      .eq('student_id', studentId)
    expect(direto.error).not.toBeNull()

    const [linha] = await sql`select note from student_notes where student_id = ${studentId}`
    expect(linha.note).toContain('mãe acompanha')
  })

  it('a RPC grava, apaga e AUDITA cada versão (Lei 8)', async () => {
    const comoAdmin = await clientAs(adminUser, 'admin')

    const gravou = await comoAdmin.rpc('admin_set_student_note', {
      p_student: studentId,
      p_note: '  prefere aula de manhã  ',
    })
    expect(gravou.error).toBeNull()
    const [depois] = await sql`select note, updated_by from student_notes where student_id = ${studentId}`
    // guarda o texto SEM as bordas em branco, e quem escreveu
    expect(depois.note).toBe('prefere aula de manhã')
    expect(depois.updated_by).toBe(adminUser)

    const apagou = await comoAdmin.rpc('admin_set_student_note', {
      p_student: studentId,
      p_note: '   ',
    })
    expect(apagou.error).toBeNull()
    const vazio = await sql`select 1 from student_notes where student_id = ${studentId}`
    // "sem nota" é a AUSÊNCIA da linha, não uma string vazia guardada para sempre
    expect(vazio).toHaveLength(0)

    const auditoria = await sql`
      select diff from audit_log
       where action = 'set_student_note' and entity_id = ${studentId}::text
       order by at`
    expect(auditoria.length).toBeGreaterThanOrEqual(2)
    // a última linha é a que APAGOU: guarda o que existia e diz que agora não há
    const ultima = auditoria[auditoria.length - 1].diff
    expect(ultima.old).toBe('prefere aula de manhã')
    expect(ultima.new).toBeNull()
  })

  it('a professora escreve no aluno dela e é RECUSADA no aluno de outra', async () => {
    const comoDela = await clientAs(teacherUser, 'teacher')
    const dela = await comoDela.rpc('admin_set_student_note', {
      p_student: studentId,
      p_note: 'trouxe o material da viagem',
    })
    expect(dela.error).toBeNull()

    const comoOutra = await clientAs(outraUser, 'teacher')
    const deFora = await comoOutra.rpc('admin_set_student_note', {
      p_student: studentId,
      p_note: 'não é minha aluna',
    })
    expect(deFora.error?.message).toContain('não dá aula para este aluno')

    const comoAluno = await clientAs(studentUser, 'student')
    const doAluno = await comoAluno.rpc('admin_set_student_note', {
      p_student: studentId,
      p_note: 'sou eu mesmo',
    })
    expect(doAluno.error?.message).toContain('equipe')
  })

  it('anonimizar apaga a nota e os campos novos (esquecimento que alcança o que nasceu hoje)', async () => {
    const nomeUser = await createAuthUser(sql, 'student', 'Ex-aluno c5')
    const [s] = await sql`
      insert into students (profile_id, display_name, iana_tz, student_type, birth_date, referral_source)
      values (${nomeUser}, 'Fulano de Tal c5', 'America/Cuiaba', 'child', '2014-05-02',
              'indicação da Mariana')
      returning id`
    await sql`insert into student_notes (student_id, note) values (${s.id}, 'a mãe é difícil')`

    const comoAdmin = await clientAs(adminUser, 'admin')
    const { error } = await comoAdmin.rpc('admin_anonymize_student', {
      p_student: s.id,
      p_confirm: 'Fulano de Tal c5',
    })
    expect(error).toBeNull()

    const [ficha] = await sql`
      select display_name, birth_date, referral_source, student_type from students where id = ${s.id}`
    expect(ficha.birth_date).toBeNull()
    expect(ficha.referral_source).toBeNull()
    expect(ficha.display_name).not.toContain('Fulano')
    // criança/adulto FICA: não identifica ninguém sozinho, é a categoria
    // operacional da ficha arquivada, e a coluna é NOT NULL — trocá-la por
    // 'adult' seria substituir um dado verdadeiro por um falso.
    expect(ficha.student_type).toBe('child')

    const nota = await sql`select 1 from student_notes where student_id = ${s.id}`
    expect(nota).toHaveLength(0)
    const [reg] = await sql`
      select diff from audit_log
       where action = 'anonymize_student' and entity_id = ${s.id}::text`
    expect(reg.diff.notas_internas_apagadas).toBe(1)
  })

  it('os campos NOVOS de students seguem a policy que já existia — nada a mais', async () => {
    await sql`
      update students set student_type = 'adult', birth_date = '1990-01-10',
             referral_source = 'busca no Google'
       where id = ${studentId}`
    const comoAluno = await clientAs(studentUser, 'student')

    // O próprio aluno vê o que a escola guarda SOBRE ELE (é dado dele, e o
    // portal um dia mostra isso no perfil) …
    const meu = await comoAluno
      .from('students')
      .select('student_type, birth_date, referral_source')
      .eq('id', studentId)
    expect(meu.data?.[0]).toMatchObject({ birth_date: '1990-01-10' })

    // … e continua não vendo a ficha de mais ninguém (`students_self`).
    const [outro] = await sql`
      insert into students (display_name, iana_tz, birth_date)
      values ('Alheio c5', 'America/Cuiaba', '1988-03-03') returning id`
    const dosOutros = await comoAluno.from('students').select('birth_date').eq('id', outro.id)
    expect(dosOutros.data).toEqual([])
  })

  it('o CHECK do banco recusa um terceiro tipo de aluno', async () => {
    await expect(
      sql`insert into students (display_name, iana_tz, student_type)
          values ('Tipo errado c5', 'America/Cuiaba', 'teen')`,
    ).rejects.toThrow(/student_type/)
  })
})

/* ========================================================================== */
/* D1 — a gramática dos campos novos (pura)                                    */
/* ========================================================================== */

describe('D1 · o contrato dos campos novos com a tela', () => {
  it('o Zod aceita o que o banco promete e recusa forma estranha', () => {
    expect(
      ExtrasDoAlunoSchema.parse({
        student_type: 'child',
        birth_date: '2014-05-02',
        referral_source: 'Instagram',
        auth_cleanup_profile_id: null,
      }),
    ).toMatchObject({ student_type: 'child', birth_date: '2014-05-02' })

    // opcionais de verdade: ficha sem nascimento e sem origem é ficha válida
    expect(ExtrasDoAlunoSchema.parse({ student_type: 'adult' })).toMatchObject({
      student_type: 'adult',
    })
    // tipo desconhecido (alguém acrescentou um terceiro no banco e esqueceu da
    // tela) NÃO derruba a ficha inteira da dona — cai no padrão
    expect(ExtrasDoAlunoSchema.parse({ student_type: 'teen' }).student_type).toBe('adult')
  })

  it('a action só grava tipo que o CHECK aceita', () => {
    expect(tipoDeAlunoValido('child')).toBe(true)
    expect(tipoDeAlunoValido('adult')).toBe(true)
    expect(tipoDeAlunoValido('teen')).toBe(false)
    expect(tipoDeAlunoValido('')).toBe(false)
    // e o padrão da casa é o adulto (a base da dona)
    expect(TIPO_PADRAO).toBe('adult')
    expect(TIPO_DE_ALUNO.child).toBe('criança')
  })

  it('nascimento e origem NUNCA são obrigatórios — nem para criança', () => {
    // a régua está escrita no código das duas actions de cadastro: `required`
    // não aparece em nenhum dos dois campos, e vazio grava null.
    const wizard = codigo('src/app/admin/alunos/novo/AdmissionWizard.tsx')
    const painel = codigo('src/components/admin/alunos/ficha/paineis.tsx')
    for (const [nome, fonte] of [
      ['wizard', wizard],
      ['painel', painel],
    ] as const) {
      const nascimento = fonte.slice(fonte.indexOf('name="birth_date"'))
      expect(nascimento.slice(0, 200), nome).not.toContain('required')
    }
    const actions = codigo('src/app/admin/alunos/actions.ts')
    expect(actions).toContain("birth_date: nascimento || null")
    expect(actions).toContain("referral_source: origem || null")
  })

  it('a ficha mostra os três campos e a nota, com o aviso de quem lê', () => {
    const abas = corpo('src/components/admin/alunos/ficha/abas.tsx')
    expect(abas).toContain("rotulo: 'Tipo de aluno'")
    expect(abas).toContain("rotulo: 'Nascimento'")
    expect(abas).toContain("rotulo: 'Como conheceu a escola'")
    expect(abas).toContain('titulo="Nota interna"')
    // o rótulo é explícito: quem escreve precisa saber onde está escrevendo
    expect(abas).toContain('Visível só para a equipe — nunca para o aluno')
    // e a nota abre em Sheet pelo endereço (`?painel=nota`), como o resto
    expect(abas).toContain("painel: 'nota'")
  })
})

/* ========================================================================== */
/* D2 — plano selecionável (fase 1)                                            */
/* ========================================================================== */

describe('D2 · o plano vira escolha entre os que a escola já usa', () => {
  it('a lista é distinta, limpa e em ordem — sem nome vazio e sem quase-repetido', () => {
    expect(
      planosDoSeletor([
        'Aulas particulares',
        '  Aulas particulares  ',
        'aulas particulares',
        'Aulas do casal',
        null,
        '   ',
        undefined,
      ]),
    ).toEqual(['Aulas do casal', 'Aulas particulares'])
  })

  it('a primeira grafia vista é a que fica (menu sem duas linhas quase iguais)', () => {
    expect(planosDoSeletor(['Personal Travel', 'personal travel'])).toEqual(['Personal Travel'])
  })

  it('já vem escolhido o plano padrão; sem contrato nenhum, cai em "Outro…"', () => {
    expect(planoInicial(['Aulas do casal', PLANO_PADRAO])).toBe(PLANO_PADRAO)
    expect(planoInicial(['Aulas do casal'])).toBe('Aulas do casal')
    expect(planoInicial([])).toBe(PLANO_OUTRO)
  })

  it('o sentinela de "Outro…" nunca é um nome de plano plausível', () => {
    expect(PLANO_OUTRO).toBe('__outro__')
    expect(planosDoSeletor([PLANO_OUTRO])).not.toEqual([])
    // (o sentinela só existe no formulário; o que a lista devolve é o que o
    // banco tem — se alguém gravar literalmente '__outro__' em plan_name, ele
    // aparece como plano, e é o comportamento certo: é o que está lá.)
  })

  it('a etapa 2 manda UM campo só, e a mutação não mudou', () => {
    const etapa = codigo('src/app/admin/alunos/novo/EtapaDoContrato.tsx')
    // o Select escolhe; quem viaja é sempre `plan_name` — hidden quando a
    // escolha veio da lista, campo de texto quando é "Outro…"
    expect(etapa).toContain('<Select value={plano} onValueChange={setPlano}>')
    expect(etapa.match(/name="plan_name"/g) ?? []).toHaveLength(2)
    expect(etapa).toContain('type="hidden" name="plan_name" value={plano}')
    // e a action continua lendo o mesmo campo, sem saber de nada disto
    const action = codigo('src/app/admin/alunos/novo/actions.ts')
    expect(action).toContain("formData.get('plan_name')")
    expect(action).not.toContain(PLANO_OUTRO)
  })

  it('a leitura dos planos vem da camada de dados, sem migration', () => {
    const dados = codigo('src/data/admin/alunos.ts')
    expect(dados).toContain("supabase.from('contracts').select('plan_name')")
    expect(dados).toContain('planosDoSeletor(')
  })
})

/* ========================================================================== */
/* D3 — Ajustes sai do trilho                                                  */
/* ========================================================================== */

describe('D3 · Ajustes no menu da conta', () => {
  it('a seção continua existindo e mora fora do trilho — o destino virou a tela própria (A8)', () => {
    const nav = codigo('src/components/admin/nav.ts')
    // Era '/admin/janelas' (place-holder do M3-c5); a onda da Agenda · A8 fez
    // nascer `/admin/ajustes` e o item da conta passou a apontar para ela.
    expect(nav).toContain("href: '/admin/ajustes'")
    expect(nav).toContain('export const AJUSTES')
    // e não voltou para dentro do array do trilho
    const arr = nav.slice(nav.indexOf('export const TRILHO'), nav.indexOf('export const AJUSTES'))
    expect(arr).not.toContain('Ajustes')
  })
})

/* ========================================================================== */
/* D4 — as antecipações da auditoria B6                                        */
/* ========================================================================== */

describe('D4 · antecipações B6 (nenhuma mutação nova)', () => {
  const abas = corpo('src/components/admin/alunos/ficha/abas.tsx')
  const paineis = corpo('src/components/admin/alunos/ficha/paineis.tsx')
  const etapa = corpo('src/app/admin/alunos/novo/EtapaDoContrato.tsx')

  it('1 — anonimizar não é oferecido com contrato vivo, e a frase diz quais faltam', () => {
    // o gesto só existe quando não há contrato vivo…
    expect(abas).toContain('{ficha.contratos.length === 0 ? (')
    expect(abas).toContain('Ainda não dá para anonimizar')
    expect(abas).toContain('ficha.contratos.map((c) => c.plano).join')
    // …e o endereço digitado à mão volta para a ficha (mesma régua do estender)
    expect(paineis).toContain('if (ficha.contratos.length > 0) redirect(self)')
  })

  it('2 — o painel de pagador não oferece quem já está vinculado', () => {
    const dados = codigo('src/data/admin/ficha.ts')
    expect(dados).toContain('const jaVinculados = new Set(pagadores.map((p) => p.id))')
    expect(dados).toContain('.filter((p) => !jaVinculados.has(p.id))')
    // e as duas ausências são coisas diferentes na tela
    expect(paineis).toContain('Todos os pagadores cadastrados já estão vinculados')
    expect(paineis).toContain('Nenhum pagador cadastrado ainda')
  })

  it('3 — remarcações por mês espelha o CHECK 0–10, com exigência inline', () => {
    expect(etapa).toContain('name="allowance"')
    expect(etapa).toMatch(/name="allowance"[\s\S]{0,200}max="10"/)
    expect(etapa).toContain('de 0 a 10')
  })

  it('4 — o aviso do cancelamento não pode ser no futuro (teto do SERVIDOR)', () => {
    // A6/Lote 2: o painel de cancelar da ficha virou peça cliente própria
    // (`CancelarAula.tsx`, o primeiro AlertDialog dentro de Sheet) e o teto
    // do campo foi junto. A regra que este pino guarda é a MESMA: o máximo
    // vem do servidor, a tela só veste.
    const cancelar = codigo('src/components/admin/alunos/ficha/CancelarAula.tsx')
    expect(cancelar).toContain('max={agoraNoNegocio}')
    const dados = codigo('src/data/admin/ficha.ts')
    // Lei 1: quem faz a conta de fuso é o servidor, com Luxon e a zona do
    // negócio — a tela só veste o valor.
    expect(dados).toContain("agoraNoNegocio: agora.setZone(BUSINESS_TZ).toFormat(\"yyyy-LL-dd'T'HH:mm\")")
  })

  it('5 — só aula que ainda não começou oferece cancelar/remarcar', () => {
    const historico = abas.slice(abas.indexOf('export function AbaHistorico'))
    // a lista de PRÓXIMAS passa `futura`; a das passadas, não
    expect(historico).toContain('<LinhaDeAula key={a.id} aula={a} fichaId={ficha.id} futura />')
    expect(historico).toContain('<LinhaDeAula key={a.id} aula={a} fichaId={ficha.id} />')
    // e o gesto está DENTRO do ramo `futura`
    expect(abas).toMatch(/\{futura && \(\s*<>[\s\S]*?painel: 'cancelar'/)
    // o painel também só encontra aula entre as próximas
    expect(paineis).toContain('ficha.aulas.proximas.find((a) => a.id === alvo)')
  })

  it('6 — a faixa de dígitos do telefone vem do DDI, não de um número mágico', () => {
    // E.164: 10 a 15 dígitos CONTANDO o país. Um mínimo fixo estaria errado em
    // metade dos países — que é o tipo de "validação" que reprova dado bom.
    expect(faixaLocal('+55')).toEqual({ min: 8, max: 13 })
    expect(faixaLocal('+1')).toEqual({ min: 9, max: 14 })
    expect(faixaLocal('+351')).toEqual({ min: 7, max: 12 })

    const campo = codigo('src/components/CountryPhoneField.tsx')
    expect(campo).toContain('minLength={minDigitos}')
    // o pattern conta DÍGITOS (o campo aceita espaço, parêntese e hífen)
    expect(campo).toContain('pattern={`(?:[\\\\s()-]*\\\\d){${minDigitos},${maxDigitos}}[\\\\s()-]*`}')
    // e a frase da casa vem por setCustomValidity, que vence tudo no B3
    expect(campo).toContain('el.setCustomValidity(')
    expect(campo).toContain('Confira o número: com ${country.dial} são ${minDigitos} a ${maxDigitos} dígitos')
  })

  it('o número CERTO digitado com separadores continua passando no pattern', () => {
    const { min, max } = faixaLocal('+55')
    const pattern = new RegExp(`^(?:(?:[\\s()-]*\\d){${min},${max}}[\\s()-]*)$`)
    expect(pattern.test('65 90000-0000')).toBe(true)
    expect(pattern.test('(65) 90000-0000')).toBe(true)
    expect(pattern.test('65900000000')).toBe(true)
    // e o obviamente curto, não
    expect(pattern.test('9922')).toBe(false)
  })
})
