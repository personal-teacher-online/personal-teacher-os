// F7 — Cadastro, convite e LGPD (plano integrado v2, 18/07/2026): ciência do
// canal (M4-3), número self-service (M4-4), bounce (M4-2), anonimização pelo
// MAPA com a regra fiscal do pagador (M4-5 + M11-4) e expurgo por telefone.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  concluirBloqueioDeLogin,
  destruirLogin,
  mensagemDaAnonimizacaoTravada,
  mensagemDaRetomadaTravada,
} from '@/lib/admin/auth-cleanup'
import { clientAs, createAuthUser, serviceClient } from './helpers/auth'
import { connect, createPrivateContract, daysFromToday } from './helpers/db'

let sql: Sql
let admin: SupabaseClient

beforeAll(async () => {
  sql = connect(4)
  admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin F7'), 'admin')
})
afterAll(async () => {
  await sql.end()
})

describe('M4-3/M4-4 — ciência e número self-service', () => {
  it('ack grava timestamp uma vez; update_my_whatsapp valida e audita', async () => {
    const userId = await createAuthUser(sql, 'student', 'Aluno F7')
    const student = await clientAs(userId, 'student')

    // Lote 26/07: a RPC passou a exigir o id da versão de política EXIBIDA
    // (o aceite prova o texto, não só o clique).
    const [pv] = await sql`
      select id from policy_versions where kind = 'ciencia-canais' order by version desc limit 1`
    const aceitar = () => student.rpc('ack_channel_notice', { p_policy_version_id: pv.id })

    await aceitar()
    const [p1] = await sql`select whatsapp_channel_ack_at from profiles where id = ${userId}`
    expect(p1.whatsapp_channel_ack_at).not.toBeNull()
    const primeiro = p1.whatsapp_channel_ack_at
    await aceitar() // idempotente: primeiro carimbo fica
    const [p2] = await sql`select whatsapp_channel_ack_at from profiles where id = ${userId}`
    expect(String(p2.whatsapp_channel_ack_at)).toBe(String(primeiro))

    const ruim = await student.rpc('update_my_whatsapp', { p_e164: 'abc' })
    expect(ruim.error?.message).toContain('inválido')
    const { error } = await student.rpc('update_my_whatsapp', { p_e164: '+5565900080018' })
    expect(error).toBeNull()
    const [p3] = await sql`select whatsapp_e164 from profiles where id = ${userId}`
    expect(p3.whatsapp_e164).toBe('+5565900080018')
    const audit = await sql`
      select 1 from audit_log where action = 'update_my_whatsapp' and entity_id = ${userId}::text`
    expect(audit.length).toBeGreaterThanOrEqual(1)
  })

  // CORREÇÃO 28/07 — o WhatsApp virou canal de CONTRATO: trocar sim, apagar não.
  // Antes desta migration um submit com o campo vazio gravava NULL e a escola
  // perdia o canal em silêncio (o dispatch só falharia no próximo lembrete).
  it('update_my_whatsapp recusa vazio e NÃO apaga o número que já existia', async () => {
    const userId = await createAuthUser(sql, 'student', 'Aluno contrato')
    const student = await clientAs(userId, 'student')

    const posto = await student.rpc('update_my_whatsapp', { p_e164: '+5565900090019' })
    expect(posto.error).toBeNull()

    // as duas formas de "vazio" que o formulário pode produzir
    for (const vazio of ['', '   ', null]) {
      const r = await student.rpc('update_my_whatsapp', { p_e164: vazio })
      expect(r.error?.message, `p_e164=${JSON.stringify(vazio)}`).toContain('whatsapp-obrigatorio')
    }

    // a recusa não destrói o dado bom (a metade que importa deste teste)
    const [depois] = await sql`select whatsapp_e164 from profiles where id = ${userId}`
    expect(depois.whatsapp_e164).toBe('+5565900090019')

    // e TROCAR continua funcionando — a regra fecha a porta certa
    const troca = await student.rpc('update_my_whatsapp', { p_e164: '+351900000027' })
    expect(troca.error).toBeNull()
    const [final] = await sql`select whatsapp_e164 from profiles where id = ${userId}`
    expect(final.whatsapp_e164).toBe('+351900000027')
  })

  // Rodada do Sol (achado 4): a RPC aceitava `^\+?[0-9]{10,15}$` — número sem
  // '+' e até '0000000000' passavam, divergindo da action e do driver Evolution
  // (que armazenam/leem E.164 canônico COM '+'). As duas portas têm de recusar
  // o MESMO conjunto.
  it('update_my_whatsapp usa a régua E.164 canônica da action — com "+", sem zero à esquerda', async () => {
    const userId = await createAuthUser(sql, 'student', 'Aluno E164')
    const student = await clientAs(userId, 'student')

    const troca = await student.rpc('update_my_whatsapp', { p_e164: '+5565999999999' })
    expect(troca.error).toBeNull()

    // Rodada 2: '+0999999999999' TEM o '+' e o comprimento certo — só o
    // primeiro dígito viola o `[1-9]`. Os casos sem '+' nunca provariam essa
    // classe (falhariam pelo prefixo antes de chegar ao dígito).
    for (const ruim of ['0000000000', '65999999999', '+0999999999999']) {
      const r = await student.rpc('update_my_whatsapp', { p_e164: ruim })
      expect(r.error?.message, `p_e164=${ruim}`).toContain('inválido')
    }

    // a recusa não tocou no número bom
    const [p] = await sql`select whatsapp_e164 from profiles where id = ${userId}`
    expect(p.whatsapp_e164).toBe('+5565999999999')
  })

  // Rodada 2 do Sol (achado 4): a régua deixou de ser só corpo de RPC — virou
  // CHECK na coluna. A prova aqui contorna a RPC de propósito (UPDATE direto
  // por SQL, como faria uma action nova ou um script de service_role): se a
  // constraint não existir, este caminho grava lixo sem ninguém reclamar.
  it('a régua é ESTRUTURAL: UPDATE direto por SQL com valor inválido estoura a constraint', async () => {
    const userId = await createAuthUser(sql, 'student', 'Aluno Constraint')

    await expect(
      sql`update profiles set whatsapp_e164 = '0000000000' where id = ${userId}`,
    ).rejects.toThrowError(/profiles_whatsapp_e164_formato/)

    // NULL continua permitido (decisão aceita: o admin pode limpar pela ficha)…
    await sql`update profiles set whatsapp_e164 = null where id = ${userId}`
    // …e o valor canônico entra sem RPC nenhuma.
    await sql`update profiles set whatsapp_e164 = '+5565900000020' where id = ${userId}`
    const [p] = await sql`select whatsapp_e164 from profiles where id = ${userId}`
    expect(p.whatsapp_e164).toBe('+5565900000020')
  })

  // Rodada do Sol (achado 5): UPDATE sem linha atingida era sucesso silencioso —
  // conta autenticada sem perfil recebia "Número atualizado ✓" e um registro de
  // auditoria de uma escrita que nunca aconteceu.
  it('conta autenticada SEM perfil: exceção, e nenhum audit falso', async () => {
    const userId = await createAuthUser(sql, 'student', 'Aluno Sem Perfil')
    // vira o órfão real do provisionamento: auth user existe, profile não
    await sql`delete from profiles where id = ${userId}`
    const student = await clientAs(userId, 'student')

    const r = await student.rpc('update_my_whatsapp', { p_e164: '+5565900090009' })
    expect(r.error?.message).toContain('perfil não encontrado')

    const audit = await sql`
      select 1 from audit_log where action = 'update_my_whatsapp' and entity_id = ${userId}::text`
    expect(audit).toHaveLength(0)
  })
})

// Rodada 3 do Sol (achado 1, Leis 3+8): a porta do ADMIN também virou RPC —
// update + audit COM ATOR numa transação só. O par antigo no app (UPDATE via
// TS + audit separado fail-open) admitia número trocado sem trilha de quem
// trocou. Estes testes cobram o comportamento contra o Postgres de verdade.
describe('admin_update_student_whatsapp — a porta do admin é transacional', () => {
  it('ator NULL → exceção, nada gravado (trilha sem autor era o defeito)', async () => {
    // Rodada 4 do Sol: sem esta recusa, a RPC podia alterar o número e
    // produzir exatamente a linha de auditoria sem autor que ela veio matar.
    // `{ whatsapp: null }` explícito: a fixture de aluno nasce COM número desde o
    // A6/i (o vínculo do acesso passou a exigi-lo), e o que este teste mede é que a
    // recusa não GRAVA nada — precisa começar do nada.
    const userId = await createAuthUser(sql, 'student', 'Aluno Sem Ator', { whatsapp: null })
    const svc = serviceClient()

    const r = await svc.rpc('admin_update_student_whatsapp', {
      p_profile: userId, p_e164: '+5565900010021', p_actor: null,
    })
    expect(r.error?.message).toContain('ator obrigatório')
    const [p] = await sql`select whatsapp_e164 from profiles where id = ${userId}`
    expect(p.whatsapp_e164).toBeNull()
  })

  it('feliz: grava o número e a MESMA transação registra o ator na trilha', async () => {
    const userId = await createAuthUser(sql, 'student', 'Aluno Ficha')
    const actorId = await createAuthUser(sql, 'admin', 'Admin Ficha')
    const svc = serviceClient()

    const { error } = await svc.rpc('admin_update_student_whatsapp', {
      p_profile: userId, p_e164: '+5565900020022', p_actor: actorId,
    })
    expect(error).toBeNull()

    const [p] = await sql`select whatsapp_e164 from profiles where id = ${userId}`
    expect(p.whatsapp_e164).toBe('+5565900020022')
    const [a] = await sql`
      select actor, diff from audit_log
       where action = 'update_student_whatsapp' and entity_id = ${userId}::text`
    expect(a).toBeDefined()
    expect(a.actor).toBe(actorId)
    expect(a.diff.whatsapp_e164).toBe('+5565900020022')
  })

  it('NULL limpa o número E audita a limpeza (decisão aceita, agora com trilha)', async () => {
    const userId = await createAuthUser(sql, 'student', 'Aluno Limpo')
    const actorId = await createAuthUser(sql, 'admin', 'Admin Limpa')
    const svc = serviceClient()

    await svc.rpc('admin_update_student_whatsapp', {
      p_profile: userId, p_e164: '+5565900010021', p_actor: actorId,
    })
    const { error } = await svc.rpc('admin_update_student_whatsapp', {
      p_profile: userId, p_e164: null, p_actor: actorId,
    })
    expect(error).toBeNull()

    const [p] = await sql`select whatsapp_e164 from profiles where id = ${userId}`
    expect(p.whatsapp_e164).toBeNull()
    // duas escritas, duas linhas — e a da limpeza carrega o NULL no diff:
    // antes da rodada 3 a limpeza pela ficha era um UPDATE mudo.
    const trilha = await sql`
      select diff from audit_log
       where action = 'update_student_whatsapp' and entity_id = ${userId}::text
       order by id`
    expect(trilha).toHaveLength(2)
    expect(trilha[1].diff.whatsapp_e164).toBeNull()
  })

  it('perfil inexistente → exceção, e nenhum audit fantasma', async () => {
    const actorId = await createAuthUser(sql, 'admin', 'Admin Fantasma')
    const svc = serviceClient()
    const inexistente = crypto.randomUUID()

    const r = await svc.rpc('admin_update_student_whatsapp', {
      p_profile: inexistente, p_e164: '+5565900030023', p_actor: actorId,
    })
    expect(r.error?.message).toContain('perfil não encontrado')
    const audit = await sql`
      select 1 from audit_log
       where action = 'update_student_whatsapp' and entity_id = ${inexistente}`
    expect(audit).toHaveLength(0)
  })

  it('formato fora do E.164 canônico → exceção (a mesma régua das outras portas)', async () => {
    // `{ whatsapp: null }`: ver a nota do 'Aluno Sem Ator' — o teste mede que a
    // recusa de formato não grava nada.
    const userId = await createAuthUser(sql, 'student', 'Aluno Régua', { whatsapp: null })
    const actorId = await createAuthUser(sql, 'admin', 'Admin Régua')
    const svc = serviceClient()

    for (const ruim of ['0000000000', '65999999999', '+0999999999999']) {
      const r = await svc.rpc('admin_update_student_whatsapp', {
        p_profile: userId, p_e164: ruim, p_actor: actorId,
      })
      expect(r.error?.message, `p_e164=${ruim}`).toContain('inválido')
    }
    const [p] = await sql`select whatsapp_e164 from profiles where id = ${userId}`
    expect(p.whatsapp_e164).toBeNull() // a recusa não gravou nada
  })
})

// PORTÃO DE DEPLOY 29/07 (bloqueador 2, Leis 3+8) — o NASCIMENTO do número
// ganhou a irmã transacional da porta de troca. Antes, o perfil nascia por um
// INSERT em TS e a auditoria com ator era uma chamada SEPARADA que ENGOLIA a
// falha: existia um mundo com aluno criado, número gravado, convite enviado e
// ZERO trilha de quem cadastrou aquele número.
describe('admin_create_student_profile — o nascimento do número é transacional', () => {
  /** Um auth user SEM perfil — o estado exato em que o provisionamento chama a
   *  RPC (createUser já rodou, o perfil ainda não existe). */
  async function contaSemPerfil(nome: string): Promise<string> {
    const id = await createAuthUser(sql, 'student', nome)
    await sql`delete from profiles where id = ${id}`
    return id
  }

  it('ator NULL → exceção e NENHUM perfil criado', async () => {
    const userId = await contaSemPerfil('Nascimento Sem Ator')
    const r = await serviceClient().rpc('admin_create_student_profile', {
      p_profile: userId,
      p_full_name: 'Aluno Sem Ator',
      p_iana_tz: 'America/Cuiaba',
      p_e164: '+5565900000010',
      p_actor: null,
    })
    expect(r.error?.message).toContain('ator obrigatório')
    const perfis = await sql`select 1 from profiles where id = ${userId}`
    expect(perfis).toHaveLength(0)
  })

  it('feliz: perfil nasce com número, papel e fuso — e a MESMA transação registra o ator', async () => {
    const userId = await contaSemPerfil('Nascimento Feliz')
    const actorId = await createAuthUser(sql, 'admin', 'Admin Nascimento')

    const { error } = await serviceClient().rpc('admin_create_student_profile', {
      p_profile: userId,
      p_full_name: 'Aluna Nova',
      p_iana_tz: 'Europe/Lisbon',
      p_e164: '+351900000027',
      p_actor: actorId,
    })
    expect(error).toBeNull()

    const [p] = await sql`
      select role, full_name, iana_tz, whatsapp_e164 from profiles where id = ${userId}`
    expect(p.role).toBe('student') // papel LITERAL do banco, nunca de argumento
    expect(p.full_name).toBe('Aluna Nova')
    expect(p.iana_tz).toBe('Europe/Lisbon')
    expect(p.whatsapp_e164).toBe('+351900000027')

    const [a] = await sql`
      select actor, diff from audit_log
       where action = 'create_student_whatsapp' and entity_id = ${userId}::text`
    expect(a).toBeDefined()
    expect(a.actor).toBe(actorId)
    expect(a.diff.whatsapp_e164).toBe('+351900000027')
  })

  it('PROVA DE MUTAÇÃO: auditoria que falha DESFAZ a gravação do perfil', async () => {
    // Ator ADMIN de verdade no `app_metadata` (passa o porteiro de papel do
    // A4), mas SEM linha em `profiles`: o INSERT do perfil roda primeiro e o
    // `log_audit` estoura na FK de `audit_log.actor`. Com as duas escritas na
    // MESMA transação, o perfil não sobrevive. Se alguém voltar a auditar por
    // fora (fail-open), este caso fica vermelho — o perfil ficaria de pé sem
    // trilha, que é exatamente o defeito.
    //
    // (Antes do A4 este caso usava um uuid ALEATÓRIO como ator. Com o porteiro
    // de papel, um uuid aleatório passa a ser recusado ANTES do INSERT — a
    // prova de rollback morreria sem ninguém notar, e o teste continuaria
    // verde pelo motivo errado. Daí o ator ser admin-sem-perfil.)
    const userId = await contaSemPerfil('Nascimento Auditoria')
    const atorSemPerfil = await createAuthUser(sql, 'admin', 'Admin Sem Perfil')
    await sql`delete from profiles where id = ${atorSemPerfil}`

    const r = await serviceClient().rpc('admin_create_student_profile', {
      p_profile: userId,
      p_full_name: 'Aluno Rollback',
      p_iana_tz: 'America/Cuiaba',
      p_e164: '+5565900080018',
      p_actor: atorSemPerfil,
    })
    expect(r.error).not.toBeNull()
    // …E A CAUSA É FIXADA, não apenas "não é o porteiro" (Sol · rodada 1 do A4,
    // menor 2). A versão anterior só exigia que a mensagem NÃO contivesse
    // "restrito à admin": qualquer guarda pré-INSERT futura, com outra frase,
    // deixaria este caso verde pelo motivo errado — exatamente o acidente que o
    // parágrafo acima narra tendo acontecido uma vez. Agora se cobra a
    // assinatura da FK do `audit_log`: violação de chave estrangeira (SQLSTATE
    // 23503) na coluna `actor`.
    expect(r.error?.code, 'a falha deixou de ser violação de FK').toBe('23503')
    expect(r.error?.message).toContain('audit_log')
    expect(r.error?.message).toContain('actor')
    expect(r.error?.message).not.toContain('restrito à admin')

    const perfis = await sql`select 1 from profiles where id = ${userId}`
    expect(perfis, 'o perfil sobreviveu a uma auditoria que falhou').toHaveLength(0)
  })

  // A4 (29/07) — DEFESA EM PROFUNDIDADE do apêndice: "ator obrigatório" não
  // respondia à pergunta que a trilha promete ("quem convidou e cadastrou este
  // número"). Duas frestas, as duas fechadas DENTRO do banco (Lei 3).
  it('ator = o PRÓPRIO aluno → recusado, e nenhum perfil nasce', async () => {
    // A fresta era real: o ator fantasma quebra na FK do `audit_log`, mas o
    // perfil recém-inserido SATISFAZ essa FK — o cadastro sairia atribuído ao
    // próprio cadastrado, com cara de trilha válida.
    const userId = await contaSemPerfil('Nascimento Autoatribuído')
    const r = await serviceClient().rpc('admin_create_student_profile', {
      p_profile: userId,
      p_full_name: 'Aluno de Si Mesmo',
      p_iana_tz: 'America/Cuiaba',
      p_e164: '+5565900000020',
      p_actor: userId,
    })
    expect(r.error?.message).toContain('não pode ser o próprio aluno')
    expect(await sql`select 1 from profiles where id = ${userId}`).toHaveLength(0)
    expect(
      await sql`select 1 from audit_log where entity_id = ${userId}::text
                 and action = 'create_student_whatsapp'`,
      'trilha de um cadastro que não aconteceu',
    ).toHaveLength(0)
  })

  it('ator sem papel de admin → recusado, e nenhum perfil nasce', async () => {
    const svc = serviceClient()
    for (const papel of ['student', 'teacher', 'sales'] as const) {
      const userId = await contaSemPerfil(`Nascimento Papel ${papel}`)
      const ator = await createAuthUser(sql, papel, `Ator ${papel}`)
      const r = await svc.rpc('admin_create_student_profile', {
        p_profile: userId,
        p_full_name: 'Aluno de Papel Errado',
        p_iana_tz: 'America/Cuiaba',
        p_e164: '+5565900040024',
        p_actor: ator,
      })
      expect(r.error?.message, papel).toContain('restrito à admin')
      expect(await sql`select 1 from profiles where id = ${userId}`, papel).toHaveLength(0)
    }
  })

  it('o papel é lido no app_metadata, NUNCA no espelho `profiles.role` (Lei 4)', async () => {
    // O ataque canônico invertido: perfil dizendo "admin" com o app_metadata
    // dizendo outra coisa. Quem manda é o app_metadata — o mesmo campo que o
    // `roleFromUser` do app lê do JWT; `profiles.role` é, por comentário do
    // próprio schema, "referência operacional".
    const userId = await contaSemPerfil('Nascimento Espelho')
    const ator = await createAuthUser(sql, 'student', 'Ator Espelhado')
    await sql`update profiles set role = 'admin'::user_role where id = ${ator}`

    const r = await serviceClient().rpc('admin_create_student_profile', {
      p_profile: userId,
      p_full_name: 'Aluno do Espelho',
      p_iana_tz: 'America/Cuiaba',
      p_e164: '+5565900050025',
      p_actor: ator,
    })
    expect(r.error?.message).toContain('restrito à admin')
    expect(await sql`select 1 from profiles where id = ${userId}`).toHaveLength(0)
  })

  it('número vazio ou fora da régua → exceção, e nenhum perfil nasce', async () => {
    const actorId = await createAuthUser(sql, 'admin', 'Admin Régua Nascimento')
    const svc = serviceClient()

    // vazio: no NASCIMENTO não existe "sem número" (diferente da limpeza pela ficha)
    for (const vazio of ['', '   ', null]) {
      const userId = await contaSemPerfil(`Nascimento Vazio ${String(vazio)}`)
      const r = await svc.rpc('admin_create_student_profile', {
        p_profile: userId,
        p_full_name: 'Aluno Vazio',
        p_iana_tz: 'America/Cuiaba',
        p_e164: vazio,
        p_actor: actorId,
      })
      expect(r.error?.message, `p_e164=${JSON.stringify(vazio)}`).toContain('whatsapp-obrigatorio')
      expect(await sql`select 1 from profiles where id = ${userId}`).toHaveLength(0)
    }

    for (const ruim of ['0000000000', '65999999999', '+0999999999999']) {
      const userId = await contaSemPerfil(`Nascimento Ruim ${ruim}`)
      const r = await svc.rpc('admin_create_student_profile', {
        p_profile: userId,
        p_full_name: 'Aluno Ruim',
        p_iana_tz: 'America/Cuiaba',
        p_e164: ruim,
        p_actor: actorId,
      })
      expect(r.error?.message, `p_e164=${ruim}`).toContain('inválido')
      expect(await sql`select 1 from profiles where id = ${userId}`).toHaveLength(0)
    }
  })
})

describe('M4-2 — bounce do Resend', () => {
  it('mark_email_bounced marca o perfil pelo e-mail (service_role)', async () => {
    const userId = await createAuthUser(sql, 'student', 'Aluno bounce')
    const [u] = await sql`select email from auth.users where id = ${userId}`
    const svc = serviceClient()
    const { data: n, error } = await svc.rpc('mark_email_bounced', {
      p_email: u.email, p_reason: 'mailbox full',
    })
    expect(error).toBeNull()
    expect(n).toBe(1)
    const [p] = await sql`select email_bounced_at, email_bounce_reason from profiles where id = ${userId}`
    expect(p.email_bounced_at).not.toBeNull()
    expect(p.email_bounce_reason).toBe('mailbox full')
  })
})

describe('M4-5/M11-4 — anonimização pelo MAPA', () => {
  async function exStudentFixture() {
    const c = await createPrivateContract(sql)
    const userId = await createAuthUser(sql, 'student', 'Fulano Detal')
    await sql`update students set profile_id = ${userId}, display_name = 'Fulano Detal',
              city = 'Cuiabá', level = 'B1' where id = ${c.studentId}`
    await sql`update profiles set whatsapp_e164 = '+5565900060026' where id = ${userId}`
    await sql`update contracts set status = 'ended', ended_on = current_date where id = ${c.contractId}`
    return { ...c, userId }
  }

  it('exige confirmação exata e contratos encerrados; aplica o mapa; ledger fica', async () => {
    const f = await exStudentFixture()
    const errada = await admin.rpc('admin_anonymize_student', {
      p_student: f.studentId, p_confirm: 'Nome Errado',
    })
    expect(errada.error?.message).toContain('confirmação')

    // contrato ativo trava
    const ativo = await createPrivateContract(sql)
    const travado = await admin.rpc('admin_anonymize_student', {
      p_student: ativo.studentId, p_confirm: 'Aluno ' + '',
    })
    expect(travado.error).not.toBeNull()

    // crédito histórico fica (esqueleto)
    await sql`insert into makeup_ledger (contract_id, delta, reason, expires_on)
              values (${f.contractId}, 1, 'manual_adjust', ${daysFromToday(-10)})`

    const { data, error } = await admin.rpc('admin_anonymize_student', {
      p_student: f.studentId, p_confirm: 'Fulano Detal',
    })
    expect(error).toBeNull()
    const r = data as { phone: string | null; profile_id: string | null }
    expect(r.phone).toBe('+5565900060026')
    expect(r.profile_id).toBe(f.userId)

    const [s] = await sql`
      select display_name, city, level, profile_id from students where id = ${f.studentId}`
    expect(s.display_name).toContain('Ex-aluno')
    expect(s.city).toBeNull()
    expect(s.level).toBeNull()
    expect(s.profile_id).toBeNull()
    const [p] = await sql`select full_name, whatsapp_e164 from profiles where id = ${f.userId}`
    expect(p.full_name).toBe('Ex-aluno(a)')
    expect(p.whatsapp_e164).toBeNull()
    const ledger = await sql`select 1 from makeup_ledger where contract_id = ${f.contractId}`
    expect(ledger.length).toBeGreaterThanOrEqual(1)
    const audit = await sql`
      select 1 from audit_log where action = 'anonymize_student' and entity_id = ${f.studentId}::text`
    expect(audit).toHaveLength(1)
  })

  it('pagador exclusivo: com Asaas fica 5 anos; sem Asaas é limpo', async () => {
    const f = await exStudentFixture()
    const [fiscal] = await sql`
      insert into payers (name, email, asaas_customer_id)
      values ('Pai Fiscal', 'pai@x.com', 'cus_123' || gen_random_uuid())
      returning id`
    const [semAsaas] = await sql`
      insert into payers (name, email) values ('Mãe Sem Cobrança', 'mae@x.com')
      returning id`
    await sql`insert into student_payers (student_id, payer_id)
              values (${f.studentId}, ${fiscal.id}), (${f.studentId}, ${semAsaas.id})`

    const { data, error } = await admin.rpc('admin_anonymize_student', {
      p_student: f.studentId, p_confirm: 'Fulano Detal',
    })
    expect(error).toBeNull()
    const r = data as { payers_fiscal: number; payers_scrubbed: number }
    expect(r.payers_fiscal).toBe(1)
    expect(r.payers_scrubbed).toBe(1)
    const [pf] = await sql`select name from payers where id = ${fiscal.id}`
    expect(pf.name).toBe('Pai Fiscal') // preservado (obrigação fiscal, 5 anos)
    const [ps] = await sql`select name, email from payers where id = ${semAsaas.id}`
    expect(ps.name).toBe('Pagador removido')
    expect(ps.email).toBeNull()
  })

  it('expurgo por telefone limpa a caixa Evolution', async () => {
    const run = crypto.randomUUID().slice(0, 8)
    await sql`
      insert into webhook_inbox (source, event_id, payload) values
      ('evolution', ${'f7-' + run + '-a'}, '{"event":"messages.upsert","from":"5565900060026"}'::jsonb),
      ('evolution', ${'f7-' + run + '-b'}, '{"event":"messages.upsert","from":"5599000000000"}'::jsonb)`
    const { data: n, error } = await admin.rpc('admin_purge_evolution_by_phone', {
      p_phone: '+55 65 90006-0026',
    })
    expect(error).toBeNull()
    expect(Number(n)).toBeGreaterThanOrEqual(1)
    const left = await sql`
      select event_id from webhook_inbox where source = 'evolution' and event_id like ${'f7-' + run + '-%'}`
    expect(left.map((x) => x.event_id)).toEqual([`f7-${run}-b`])
  })

  it('expurgo por telefone limpa também os recibos da Meta (origem meta, M3-1 #42)', async () => {
    // O recibo da Meta traz o telefone do aluno em `recipient_id` (só dígitos);
    // o da Evolution, dentro do `remoteJid`. Os dois saem com o mesmo pedido.
    const run = crypto.randomUUID().slice(0, 8)
    await sql`
      insert into webhook_inbox (source, event_id, payload) values
      ('meta', ${'wamid.F7' + run + 'A:delivered'},
        '{"status":{"status":"delivered","recipient_id":"5565900060027"},"metadata":{"phone_number_id":"100000000000001"}}'::jsonb),
      ('meta', ${'wamid.F7' + run + 'B:delivered'},
        '{"status":{"status":"delivered","recipient_id":"5565900060099"},"metadata":{"phone_number_id":"100000000000001"}}'::jsonb),
      ('evolution', ${'f7-' + run + '-c'}, '{"event":"messages.upsert","from":"5565900060027@s.whatsapp.net"}'::jsonb)`
    const { error } = await admin.rpc('admin_purge_evolution_by_phone', { p_phone: '+55 65 90006-0027' })
    expect(error).toBeNull()
    const left = await sql`
      select event_id from webhook_inbox
       where event_id in (${'wamid.F7' + run + 'A:delivered'}, ${'wamid.F7' + run + 'B:delivered'}, ${'f7-' + run + '-c'})`
    expect(left.map((x) => x.event_id)).toEqual([`wamid.F7${run}B:delivered`])
  })

  // -------------------------------------------------------------------------
  // S1 (revisão adversarial nº 3): o ban do Auth roda FORA da transação. O que
  // ficou por fazer tem que virar ESTADO — senão a segunda tentativa recebe
  // profile_id null, pula o ban e a tela ainda diz "login destruído".
  // -------------------------------------------------------------------------
  it('a pendência do login é gravada na MESMA transação que desvincula a ficha', async () => {
    const f = await exStudentFixture()
    const { error } = await admin.rpc('admin_anonymize_student', {
      p_student: f.studentId, p_confirm: 'Fulano Detal',
    })
    expect(error).toBeNull()
    const [s] = await sql`
      select profile_id, auth_cleanup_profile_id from students where id = ${f.studentId}`
    expect(s.profile_id).toBeNull()          // vínculo desfeito
    expect(s.auth_cleanup_profile_id).toBe(f.userId) // login ainda a destruir
  })

  it('caminho "falhou → pendente → concluir": a 2ª rodada devolve o login pendente', async () => {
    const f = await exStudentFixture()
    // 1ª rodada: a ficha é anonimizada; o ban (HTTP, fora daqui) FALHA — no
    // teste isso é simplesmente não acontecer, que é o estado que a action
    // deixa quando o Auth recusa.
    const primeira = await admin.rpc('admin_anonymize_student', {
      p_student: f.studentId, p_confirm: 'Fulano Detal',
    })
    expect(primeira.error).toBeNull()
    expect((primeira.data as { profile_id: string | null }).profile_id).toBe(f.userId)

    // Re-submissão do formulário (agora com o nome novo da ficha): ANTES do S1
    // isto devolvia null e a tela afirmava "login destruído" sem ban nenhum.
    const [s1] = await sql`select display_name from students where id = ${f.studentId}`
    const segunda = await admin.rpc('admin_anonymize_student', {
      p_student: f.studentId, p_confirm: s1.display_name,
    })
    expect(segunda.error).toBeNull()
    const r2 = segunda.data as { profile_id: string | null; auth_cleanup_pending: boolean }
    expect(r2.profile_id).toBe(f.userId)
    expect(r2.auth_cleanup_pending).toBe(true)

    // Ban bem-sucedido → a action baixa a pendência. Idempotente: de novo é false.
    const baixou = await admin.rpc('admin_clear_auth_cleanup', { p_student: f.studentId })
    expect(baixou.error).toBeNull()
    expect(baixou.data).toBe(true)
    const denovo = await admin.rpc('admin_clear_auth_cleanup', { p_student: f.studentId })
    expect(denovo.error).toBeNull()
    expect(denovo.data).toBe(false)

    const [s2] = await sql`select auth_cleanup_profile_id from students where id = ${f.studentId}`
    expect(s2.auth_cleanup_profile_id).toBeNull()
    const auditoria = await sql`
      select 1 from audit_log
       where action = 'anonymize_student_auth_done' and entity_id = ${f.studentId}::text`
    expect(auditoria).toHaveLength(1) // a baixa idempotente NÃO audita duas vezes
  })

  it('aluno sem login nunca fica com pendência fantasma', async () => {
    const c = await createPrivateContract(sql)
    await sql`update students set display_name = 'Sem Login' where id = ${c.studentId}`
    await sql`update contracts set status = 'ended', ended_on = current_date where id = ${c.contractId}`
    const { data, error } = await admin.rpc('admin_anonymize_student', {
      p_student: c.studentId, p_confirm: 'Sem Login',
    })
    expect(error).toBeNull()
    expect((data as { auth_cleanup_pending: boolean }).auth_cleanup_pending).toBe(false)
    const [s] = await sql`select auth_cleanup_profile_id from students where id = ${c.studentId}`
    expect(s.auth_cleanup_profile_id).toBeNull()
    expect(await admin.rpc('admin_clear_auth_cleanup', { p_student: c.studentId })).toMatchObject({
      data: false,
    })
  })

  it('admin_clear_auth_cleanup é restrita à admin', async () => {
    const aluno = await clientAs(await createAuthUser(sql, 'student', 'Aluno S1'), 'student')
    const { error } = await aluno.rpc('admin_clear_auth_cleanup', {
      p_student: crypto.randomUUID(),
    })
    expect(error?.message).toContain('restrita à admin')
  })
})

/* ==========================================================================
   F2 (revisão adversarial nº 4) — o coordenador do bloqueio de login.

   O que o banco garante já está provado acima. O que faltava era o outro lado:
   as actions chamavam `admin_report_anonymize_failure` e IGNORAVAM o `error`,
   e a tela dizia "o caso ficou registrado na auditoria" mesmo quando não
   ficara. Aqui o cliente é um dublê — dá para forçar o Auth a recusar e o
   registro a falhar, que é justamente o que não acontece contra um banco são.
   ========================================================================== */

describe('concluirBloqueioDeLogin', () => {
  const PERFIL = '11111111-2222-3333-4444-555555555555'

  /** Dublê do cliente admin: o ban responde o que o teste mandar. */
  const authQue = (resposta: { error: { message: string } | null } | Error) => {
    const chamadas: string[] = []
    return {
      chamadas,
      cliente: {
        auth: {
          admin: {
            updateUserById: async (id: string) => {
              chamadas.push(id)
              if (resposta instanceof Error) throw resposta
              return resposta
            },
          },
        },
      },
    }
  }

  /** Dublê do cliente de sessão: guarda as RPCs e devolve erro por nome. */
  const dbQue = (erros: Record<string, string> = {}) => {
    const chamadas: { fn: string; args: Record<string, unknown> }[] = []
    return {
      chamadas,
      cliente: {
        rpc: async (fn: string, args: Record<string, unknown>) => {
          chamadas.push({ fn, args })
          return { error: erros[fn] ? { message: erros[fn] } : null }
        },
      },
    }
  }

  it('ban recusado + registro OK: falha honesta, com rastro', async () => {
    const auth = authQue({ error: { message: 'Auth fora do ar' } })
    const db = dbQue()
    const res = await concluirBloqueioDeLogin({
      admin: auth.cliente, db: db.cliente, studentId: 'aluno-1', profileId: PERFIL,
    })
    expect(res).toEqual({
      ok: false, falha: 'Auth fora do ar', registrado: true, erroDoRegistro: null,
    })
    // registrou a falha e NÃO baixou a pendência (o login segue vivo)
    expect(db.chamadas.map((c) => c.fn)).toEqual(['admin_report_anonymize_failure'])
    expect(db.chamadas[0].args).toMatchObject({ p_student: 'aluno-1', p_detail: 'Auth fora do ar' })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(mensagemDaAnonimizacaoTravada(res)).toContain('ficou registrado na auditoria')
      expect(mensagemDaRetomadaTravada(res)).toContain('AINDA está ativo: Auth fora do ar')
    }
  })

  it('ban recusado + registro TAMBÉM falha: a mensagem diz que não há rastro', async () => {
    const auth = authQue({ error: { message: 'Auth fora do ar' } })
    const db = dbQue({ admin_report_anonymize_failure: 'sem conexão' })
    const res = await concluirBloqueioDeLogin({
      admin: auth.cliente, db: db.cliente, studentId: 'aluno-1', profileId: PERFIL,
      prefixoDoDetalhe: 'retomada: ',
    })
    expect(res).toMatchObject({ ok: false, registrado: false, erroDoRegistro: 'sem conexão' })
    expect(db.chamadas[0].args.p_detail).toBe('retomada: Auth fora do ar')
    if (!res.ok) {
      const msg = mensagemDaRetomadaTravada(res)
      expect(msg).toContain('NÃO pôde ser registrada na auditoria')
      expect(msg).toContain('sem conexão')
      // e nunca a frase que afirmava rastro
      expect(msg).not.toContain('ficou registrado na auditoria')
      // a pendência (que é o que garante a retomada) continua anunciada
      expect(msg).toContain('continua marcada na ficha')
      expect(mensagemDaAnonimizacaoTravada(res)).toContain('NÃO pôde ser registrada')
    }
  })

  it('exceção do cliente conta como recusa (o Auth pode lançar em vez de devolver)', async () => {
    const auth = authQue(new Error('socket hang up'))
    const db = dbQue()
    const res = await concluirBloqueioDeLogin({
      admin: auth.cliente, db: db.cliente, studentId: 'aluno-1', profileId: PERFIL,
    })
    expect(res).toMatchObject({ ok: false, falha: 'socket hang up', registrado: true })
  })

  it('ban OK + baixa falhando: sucesso, mas o aviso da ficha continua', async () => {
    const auth = authQue({ error: null })
    const db = dbQue({ admin_clear_auth_cleanup: 'deu ruim' })
    const res = await concluirBloqueioDeLogin({
      admin: auth.cliente, db: db.cliente, studentId: 'aluno-1', profileId: PERFIL,
    })
    expect(res).toEqual({ ok: true, pendenciaBaixada: false, erroDaBaixa: 'deu ruim' })
    // nada de registrar falha quando o ban passou
    expect(db.chamadas.map((c) => c.fn)).toEqual(['admin_clear_auth_cleanup'])
  })

  it('retomada é idempotente: o mesmo ban, quantas vezes for preciso', async () => {
    const auth = authQue({ error: null })
    const db = dbQue()
    const rodar = () =>
      concluirBloqueioDeLogin({
        admin: auth.cliente, db: db.cliente, studentId: 'aluno-1', profileId: PERFIL,
        prefixoDoDetalhe: 'retomada: ',
      })
    expect(await rodar()).toEqual({ ok: true, pendenciaBaixada: true, erroDaBaixa: null })
    expect(await rodar()).toEqual({ ok: true, pendenciaBaixada: true, erroDaBaixa: null })
    expect(auth.chamadas).toEqual([PERFIL, PERFIL])
    expect(db.chamadas.map((c) => c.fn)).toEqual([
      'admin_clear_auth_cleanup',
      'admin_clear_auth_cleanup',
    ])
  })

  it('o e-mail embaralhado é derivado do perfil e o ban é permanente', async () => {
    let recebido: { email?: string; password?: string; ban_duration?: string } = {}
    const admin = {
      auth: {
        admin: {
          updateUserById: async (_id: string, attrs: typeof recebido) => {
            recebido = attrs
            return { error: null }
          },
        },
      },
    }
    expect(await destruirLogin(admin, PERFIL)).toBeNull()
    expect(recebido.email).toMatch(new RegExp(`^anon-${PERFIL.slice(0, 8)}@invalid[.]local$`))
    expect(recebido.ban_duration).toBe('876000h')
    expect(recebido.password?.length).toBeGreaterThan(60)
  })
})
