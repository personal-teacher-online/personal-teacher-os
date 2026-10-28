'use server'

// Item 10 do e2e (veredito) — WIZARD DE ADMISSÃO: as MESMAS escritas dos
// fluxos avulsos (motor intocado), encadeadas em um caminho só com etapas
// puláveis. Cada action termina redirecionando para a PRÓXIMA etapa.
import { redirect } from 'next/navigation'
import {
  HORARIOS_DA_ADMISSAO,
  enderecoDaAdmissao,
  rascunhoDoContrato,
  type EtapaDaAdmissao,
} from '@/data/admin/admissao'
import { nivelValido } from '@/data/admin/alunos-grupos'
import { TETO_DO_PLANO } from '@/data/admin/contrato-novo'
import { tipoDeAlunoValido } from '@/data/admin/ficha-gramatica'
import { confirmarLocalizacao } from '@/lib/admin/confirmar-localizacao'
import { requireAdminId } from '@/lib/auth/admin'
import { POLICY } from '@/lib/policy'
import { createClient } from '@/lib/supabase/server'

/**
 * Manda o painel para a etapa seguinte, com o recado da etapa que acabou (o
 * `AvisoLegado` do hub vira toast). O ENDEREÇO sai de `enderecoDaAdmissao` — o
 * mesmo que o wizard usa para desenhar os links —, então formato de URL de
 * etapa existe num lugar só.
 */
function step(
  etapa: EtapaDaAdmissao,
  aluno: string | null,
  msg?: string,
  /** o que a pessoa digitou, quando a etapa precisa voltar preenchida (nº 12) */
  rascunho?: string,
): never {
  const destino = enderecoDaAdmissao(etapa, aluno, rascunho)
  redirect(msg ? `${destino}&msg=${encodeURIComponent(msg)}&n=${Date.now()}` : destino)
}

export async function wizardStudentAction(formData: FormData) {
  await requireAdminId()
  const name = String(formData.get('display_name') ?? '').trim()
  const tz = String(formData.get('iana_tz') ?? '').trim()
  const level = String(formData.get('level') ?? '').trim()
  const city = String(formData.get('city') ?? '').trim()
  const country = String(formData.get('country') ?? '').trim()
  const tipoBruto = String(formData.get('student_type') ?? '').trim()
  if (!name || !tz) step(1, null, 'Falha: informe nome e cidade.')

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('students')
    .insert({
      display_name: name,
      iana_tz: tz,
      level: nivelValido(level) ? level : null,
      city: city || null,
      country: country || null,
      // M3-c5 · D1: tipo, nascimento e origem. Tipo fora das duas opções não
      // entra no insert — o banco aplica o default ('adult') em vez de a action
      // escrever um palpite.
      ...(tipoDeAlunoValido(tipoBruto) ? { student_type: tipoBruto } : {}),
      birth_date: String(formData.get('birth_date') ?? '').trim() || null,
      referral_source: String(formData.get('referral_source') ?? '').trim() || null,
      // c10 · T1: o cadastro NASCE a confirmar, sempre e explicitamente (o
      // default da coluna é `true`, herança das fichas antigas). Confirmar é o
      // ato da linha de baixo; se ele falhar, o aluno fica honestamente
      // não-confirmado e a etapa 2 do wizard esbarra na guarda — em vez de um
      // selo de "fuso conferido" que ninguém conferiu.
      tz_confirmed: false,
    })
    .select('id')
    .single()
  if (error || !data) {
    step(1, null, `Falha: ${error?.message ?? 'não criou'}`)
  }
  // c9 · S3: a cidade escolhida no CityPicker é a CONFIRMAÇÃO do fuso, e
  // confirmar é ato com nome, validação e auditoria — não efeito de um insert.
  const { error: erroTz } = await confirmarLocalizacao(supabase, data.id, city, country, tz)
  step(
    2,
    data.id,
    erroTz ? `Aluno ${name} criado, mas a cidade não foi confirmada: ${erroTz}` : `Aluno ${name} criado. ✓`,
  )
}

/**
 * O erro do banco dito em gente (M3-c4 · B5).
 *
 * O horário conflitante é recusado pela exclusão GiST
 * `class_instances_teacher_no_overlap_excl` (Lei 3), e o que ela devolve é
 * *"conflicting key value violates exclusion constraint …"*. Esse texto é
 * verdade, mas não é resposta: a tela já antecipa o conflito, e quando ele
 * escapa da antecipação (duas admissões ao mesmo tempo, horário criado por
 * outra aba) a pessoa precisa ler o QUE aconteceu. Mesma régua do
 * `friendlyBookError` da agenda.
 */
function erroDeHorarioEmGente(m: string): string {
  if (m.includes('no_overlap') || m.includes('exclusion') || m.includes('exclusão')) {
    return 'a professora já tem aula nesse horário'
  }
  if (m.includes('recurring_slots_active_uniq') || m.includes('duplicate key')) {
    return 'esse horário já existe neste contrato'
  }
  if (m.includes('zona IANA')) return 'não deu para determinar o fuso do aluno'
  return m
}

/**
 * ETAPA 2 DA ADMISSÃO — contrato e horários, por UMA porta (M4-4).
 *
 * ANTES: `insert` direto em `contracts` e, depois dele, um laço chamando
 * `create_slot` por horário. Cada escrita era sua própria transação, então um
 * conflito de agenda no segundo horário deixava de pé um contrato com metade do
 * que a pessoa pediu — e a tela dizia "Contrato criado; ajuste depois". Era um
 * remendo honesto enquanto não havia caminho melhor.
 *
 * AGORA: uma chamada de `admin_create_contract` (kind `individual`, migration
 * `20260727001100`) — a MESMA RPC do wizard do M4-3. Ela cria contrato e
 * horários dentro de UMA transação, chamando `create_slot` por dentro (nenhuma
 * regra reimplementada, Lei 3) e registrando a criação inteira num `audit_log`.
 *
 * A SEMÂNTICA MUDA, e é essa a razão de ser da RPC: não existe mais "contrato de
 * pé com ajuste depois". Se um horário conflita, NADA nasce — a etapa 2 volta
 * com o motivo em português e a pessoa corrige o horário ali mesmo, com o
 * contrato ainda por criar. Tudo ou nada é o que um contrato com horário fixo
 * significa; meio contrato era um estado que ninguém pediu e que só se descobria
 * depois, na agenda vazia.
 *
 * O CONTRATO DE FORMDATA É O MESMO (`aluno`, `teacher_id`, `plan_name`,
 * `hourly_rate`, `allowance`, `started_on`, `w1/t1/d1`, `w2/t2/d2`) e o redirect
 * por etapa também — a etapa cliente `EtapaDoContrato` não muda uma linha.
 */
export async function wizardContractAction(formData: FormData) {
  await requireAdminId()
  const aluno = String(formData.get('aluno') ?? '')
  const teacherId = String(formData.get('teacher_id') ?? '')
  const plan = String(formData.get('plan_name') ?? '').trim()
  const rateBruto = String(formData.get('hourly_rate') ?? '').trim()
  const rate = Number(rateBruto)
  const allowanceBruto = String(formData.get('allowance') ?? '')
  const allowance = Number(allowanceBruto || 4)
  const startedOn = String(formData.get('started_on') ?? '')

  // Os horários que a etapa ofereceu (dois), na forma que a RPC espera. Linha
  // sem hora não é horário: continua sendo legítimo criar o contrato sem nenhum.
  const linhas = Array.from({ length: HORARIOS_DA_ADMISSAO }, (_, i) => ({
    weekday: Number(formData.get(`w${i + 1}`) ?? 1),
    hora: String(formData.get(`t${i + 1}`) ?? '').trim(),
    duracao: Number(formData.get(`d${i + 1}`) ?? 45),
  }))
  const horarios = linhas
    .filter((h) => h.hora !== '')
    .map((h) => ({ weekday: h.weekday, local_time: h.hora, duration_min: h.duracao }))

  /**
   * c12 · nº 12 — O QUE A PESSOA DIGITOU, para a etapa 2 voltar preenchida.
   *
   * Desde o M4-4 a criação é atômica: um horário conflitante derruba o contrato
   * inteiro. A volta, porém, era um formulário em branco — onze campos
   * preenchidos perdidos por causa de um. O rascunho viaja no MESMO endereço em
   * que o wizard já mora (`?rasc=`, gramática em `data/admin/admissao.ts`).
   */
  const rascunho = rascunhoDoContrato({
    professora: teacherId,
    plano: plan,
    valor: rateBruto,
    remarcacoes: allowanceBruto,
    inicio: startedOn,
    horarios: linhas,
  })
  /**
   * c13 · nº 8 — RASCUNHO QUE NÃO CABE VIRA AVISO, NÃO URL GIGANTE.
   *
   * `rascunhoDoContrato` devolve string vazia quando o pacote passa do teto
   * (`TETO_DO_RASCUNHO`, 2 KB já codificados). Aqui isso vira uma frase a mais
   * no toast, e não um endereço de 10 KB que o proxy corta calado — a pessoa
   * precisa saber POR QUE a etapa voltou em branco, senão o defeito parece ser
   * do wizard.
   */
  const coube = rascunho !== ''
  // A anotação explícita no CONST é o que faz o TypeScript entender que a
  // chamada interrompe o fluxo (mesma régua do `done` em `contratos/actions.ts`).
  const voltar: (msg: string) => never = (msg) =>
    step(
      2,
      aluno,
      coube
        ? msg
        : `${msg} (os campos não voltaram preenchidos: o que você digitou não cabe no endereço)`,
      rascunho,
    )

  if (!aluno) step(1, null)
  // c12 · nº 11 — ZERO É CORTESIA (decisão do orquestrador, S2-15). O `!rate`
  // reprovava o valor 0 junto com o vazio e o NaN, e cortesia é caso legítimo
  // da escola — o wizard do M4-3 já a aceita, e `admin_create_contract` também
  // (só o negativo recusa). O que se exige aqui é que o campo tenha sido
  // PREENCHIDO com um número que não seja negativo.
  if (!teacherId || !plan || !startedOn || rateBruto === '' || !Number.isFinite(rate) || rate < 0) {
    voltar('Falha: preencha professora, plano, valor (0 = cortesia) e início.')
  }
  // c14 · Sol 7.1: a REGRA é o CHECK `contracts_plan_name_len`; aqui só a
  // antecipação legível (`[...]` conta caracteres, como o `char_length` do
  // banco). Sem ela o POST montado à mão voltaria com o texto cru do Postgres.
  if ([...plan].length > TETO_DO_PLANO) {
    voltar(`Falha: o nome do plano cabe em ${TETO_DO_PLANO} caracteres.`)
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('admin_create_contract', {
    p_kind: 'individual',
    p_students: [aluno],
    p_plan_name: plan,
    // Lei 9: dinheiro entra em CENTAVOS.
    p_hourly_rate_cents: Math.round(rate * 100),
    p_teacher: teacherId,
    p_started_on: startedOn,
    p_allowance: allowance,
    // Item 12: a política da escola vai explícita, da constante única.
    p_min_notice: POLICY.minNotice,
    p_expiry_days: POLICY.expiryDays,
    p_school_fault_days: POLICY.schoolFaultDays,
    p_slots: horarios,
  })
  if (error || !data) {
    voltar(`Falha: ${erroDeHorarioEmGente(error?.message ?? 'contrato não criado')}`)
  }

  const criados = ((data as { slot_ids?: string[] }).slot_ids ?? []).length
  step(
    3,
    aluno,
    criados === 0
      ? 'Contrato criado (sem horário fixo ainda — dá para criar na tela do contrato). ✓'
      : `Contrato e ${criados} horário${criados === 1 ? '' : 's'} criados. ✓`,
  )
}
