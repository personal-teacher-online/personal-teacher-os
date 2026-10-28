// A LEITURA DO DETALHE DE UM CONTRATO (Onda 1 · M4-2).
//
// Por que ela mora AQUI e não dentro de `contratos.ts`: aquele arquivo é
// `server-only` e monta o cliente Supabase a partir dos cookies do request — não
// dá para chamá-lo no Vitest sem inventar harness. Esta função recebe o cliente
// por parâmetro, então o teste executa a leitura de verdade contra a bancada e
// prova o RESULTADO (contrato de aluno, de grupo, com pausa, com horário
// fechado, com desfecho pendente), em vez de provar por grep que a string da
// query está no arquivo. É o mesmo arranjo de `ficha-consultas.ts` e de
// `ocupacao-consulta.ts`; `getContractFile(id)` continua sendo a porta da tela.
//
// O QUE ESTA CAMADA NÃO FAZ (Lei 3): nenhuma regra de negócio. Saldo e próxima
// validade vêm de `contract_credit_summary()`; a situação vem de
// `contracts.status`; a contagem de aulas passadas sem desfecho é a MESMA
// pergunta que `_contract_pending_count` faz no banco (state = 'scheduled' e
// início no passado), lida aqui só para a tela poder ANTECIPAR a recusa de
// encerrar/renovar — quem recusa continua sendo a RPC.
//
// FUSO (Lei 1): toda hora e toda data chegam à tela como TEXTO pronto, calculado
// aqui com Luxon na zona certa (o horário fixo pela `slotLine`, que resolve o
// offset da próxima ocorrência daquele dia específico). Nenhum componente
// cliente desta tela formata data.
//
// DINHEIRO (Lei 9): centavos no banco; `fmtBRL` uma vez, aqui. O formulário de
// renovação também precisa do valor CRU em reais para pré-preencher o campo —
// ele vai como `valorHoraCampo`, com a conta feita neste mesmo lugar.

import { DateTime } from 'luxon'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { JanelaOcupada } from '@/lib/agenda/ocupacao'
import { BUSINESS_TZ } from '@/lib/brand/constants'
import { fmtBRL, fmtCivilDate, fmtLocal, tzLabel } from '@/lib/format'
import { slotLine } from '@/lib/slot-line'
import { enderecoDaFicha } from './ficha-gramatica'
import { lerOcupacao } from './ocupacao-consulta'
import {
  ASSINATURA_ROTULO,
  AssinaturasDoDetalheSchema,
  ContratoDoDetalheSchema,
  ContratosDestinoSchema,
  ESTADOS_TERMINAIS,
  MembrosDoGrupoSchema,
  PausasBrutasSchema,
  ProfessorasDoIndiceSchema,
  ResumosDeCreditoSchema,
  SEM_PLANO,
  SITUACAO_DE_CONTRATO_ROTULO,
  SlotsDoDetalheSchema,
  situacaoDoContrato,
  type SituacaoDeContrato,
} from './contratos-gramatica'

function exigir<T>(leitura: string, r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(`Contrato: falha ao ler ${leitura}: ${r.error.message}`)
  return r.data
}

/** As colunas do contrato que o detalhe mostra (o índice lê um subconjunto). */
export const COLUNAS_DO_DETALHE =
  'id, contract_type, plan_name, status, hourly_rate_cents, monthly_value_cents, monthly_reschedule_allowance, ' +
  'min_notice_hours, makeup_credit_expiry_days, school_fault_credit_expiry_days, is_trial, ' +
  'started_on, ended_on, renewed_from, teacher_id, student_id, student_group_id, ' +
  'group_tz_anchor_student, students!contracts_student_id_fkey(id, display_name, level, iana_tz, tz_confirmed), ' +
  'student_groups(label)'

/** Quantas semanas à frente a renovação pode marcar a virada (o banco recusa
 *  além disso: `admin_renew_contract` compara com `business_today() + 56`). */
export const DIAS_ATE_A_VIRADA = 56

/* ========================================================================== */
/* O que a tela recebe                                                         */
/* ========================================================================== */

export interface HorarioDoDetalhe {
  id: string
  /** "terça · 20:30–21:15" no fuso do horário (Lei 1, resolvido no servidor) */
  texto: string
  /** a MESMA hora no relógio da professora — só quando diverge */
  professora: string | null
  /** os campos crus, para o formulário de troca nascer preenchido */
  weekday: number
  hora: string
  duracao: number
  ianaTz: string
  fuso: string
  vigenteDe: string
  /** `null` = horário VIVO; com data = fechado (histórico) */
  encerradoEm: string | null
}

export interface PausaDoDetalhe {
  de: string
  ate: string | null
  aberta: boolean
}

export interface AssinaturaNoDetalhe {
  id: string
  status: string
  rotulo: string
  /** `null` na reserva do c14 (pending/failed): ainda não há documento lá fora */
  documento: string | null
  /** quando o PEDIDO começou — toda linha tem (c15 · Sol 8) */
  reservadaEm: string
  /**
   * Quando o documento foi VINCULADO a esta reserva; `null` = nunca houve
   * documento.
   *
   * c16 · r6 nº 8 — O NOME MUDOU PORQUE A FRASE MENTIA EM METADE DOS CASOS.
   * `sent_at` é escrito por `admin_finish_signature`, e essa RPC serve DOIS
   * chamadores: a action logo depois de criar o documento no Autentique (aí a
   * hora é mesmo a do envio) e a admin ANEXANDO à mão, horas depois, o id de um
   * documento que ela conferiu existir (aí a hora é a do anexo — o envio
   * aconteceu antes, e ninguém sabe quando). A tela dizia "enviado em" nos dois,
   * afirmando uma data de envio que era do anexo. "Vinculado em" é verdade nos
   * dois, e o banco não guarda o que faria a distinção.
   */
  vinculadaEm: string | null
  assinadaEm: string | null
  /** estado terminal (ou sem documento): não adianta oferecer "ver status" */
  terminal: boolean
  /** reserva ABERTA: é ela que pede os dois atos humanos do c15 */
  reservaAberta: boolean
}

export interface MembroDoGrupo {
  id: string
  nome: string
  fuso: string
  /** é dele o relógio que rege os horários fixos do grupo */
  ancora: boolean
}

export interface FichaDoContrato {
  id: string
  tipo: string
  /** identidade: o nome do aluno ou o rótulo do grupo */
  quem: string
  alunoId: string | null
  nivel: string | null
  plano: string
  produto: string
  experimental: boolean
  situacao: SituacaoDeContrato
  situacaoRotulo: string
  encerrado: boolean

  professora: { id: string | null; nome: string | null; idx: number }
  /** as professoras da escola, para o painel de regras não precisar de query */
  valorHora: string | null
  /** o mesmo valor em reais com dois decimais — insumo do campo de renovação */
  valorHoraCampo: string
  /** mensalidade cadastrada (F2 — alimenta o previsto v3); null = não cadastrada */
  mensalidade: string | null
  /** a mensalidade em reais com dois decimais — insumo do campo do painel */
  mensalidadeCampo: string
  politica: {
    remarcacoes: number | null
    avisoHoras: number | null
    validadeDias: number | null
    falhaDaEscolaDias: number | null
  }

  vigencia: { inicio: string; fim: string | null }
  renovacao: {
    /** de qual contrato este nasceu (`contracts.renewed_from`) */
    de: { id: string; plano: string } | null
    /** e qual nasceu dele */
    para: { id: string; plano: string } | null
  }
  pausas: PausaDoDetalhe[]
  /** há uma pausa ABERTA agora? (o banco garante no máximo uma) */
  pausado: boolean

  grupo: { label: string; membros: MembroDoGrupo[] } | null
  /** o fuso que rege os horários deste contrato (o do aluno / a âncora do grupo) */
  fusoDoHorario: { iana: string; rotulo: string }
  /** P6/c11: a cidade deste aluno é FATO ou palpite do cadastro mínimo? */
  fusoConfirmado: boolean

  horarios: HorarioDoDetalhe[]
  horariosFechados: HorarioDoDetalhe[]

  creditos: {
    /** saldo derivado; `null` em contrato encerrado (a função só olha os vivos) */
    saldo: number | null
    proximaValidade: string | null
    /** validade sugerida do ajuste manual: hoje + a regra do contrato */
    validadeSugeridaIso: string
    /** duração sugerida do crédito: a do horário fixo, quando existe */
    duracaoSugerida: number
    /** a aba Créditos da ficha — só existe quando o contrato é de UMA pessoa */
    verEm: string | null
  }

  assinaturas: AssinaturaNoDetalhe[]

  /** aulas passadas sem desfecho: o gate duro de encerrar/renovar */
  pendencias: number
  /** contratos ATIVOS do mesmo dono, destino possível dos créditos vivos */
  destinos: { id: string; plano: string }[]

  /** a agenda já ocupada das professoras, no relógio deste contrato */
  ocupacao: JanelaOcupada[]
  /** hoje e o teto da virada, em ISO — as duas pontas do campo de renovação */
  hojeIso: string
  viradaMaximaIso: string
  /**
   * O PISO da virada (c12 · nº 10): `max(hoje, started_on)`.
   *
   * O banco tem três recusas para a data da virada — não no passado, no máximo
   * 8 semanas à frente e nunca antes do `started_on` do contrato que está sendo
   * renovado (esta última nasceu no c12). O campo antecipava só as duas
   * primeiras, e um contrato que ainda vai começar aceitava uma virada de hoje
   * que o banco agora recusa — o formulário parecia válido e morria no submit.
   */
  viradaMinimaIso: string
}

/* ========================================================================== */
/* A leitura                                                                   */
/* ========================================================================== */

/**
 * O detalhe inteiro de UM contrato. `null` quando o id não existe (a página
 * responde 404) — falha de leitura, ao contrário, ESTOURA: tela nova não
 * transforma erro em estado vazio.
 */
export async function lerContratoDoDetalhe(
  supabase: SupabaseClient,
  id: string,
  agora: DateTime = DateTime.now(),
): Promise<FichaDoContrato | null> {
  const contratoRes = await supabase
    .from('contracts')
    .select(COLUNAS_DO_DETALHE)
    .eq('id', id)
    .maybeSingle()
  const bruto = exigir('o contrato', contratoRes)
  if (!bruto) return null
  const c = ContratoDoDetalheSchema.parse(bruto)

  const vazio = { data: [] as never[], error: null }
  const [
    professorasRes,
    slotsRes,
    pausasRes,
    creditosRes,
    assinaturasRes,
    pendentesRes,
    renovadoDeRes,
    renovadoParaRes,
    membrosRes,
    destinosRes,
  ] = await Promise.all([
    // A ORDEM define a cor da bolinha (dona primeiro, depois alfabética) — a
    // mesma da agenda, do Início e do hub.
    supabase
      .from('teachers')
      .select('id, display_name, is_owner, iana_tz')
      .is('archived_at', null)
      .order('is_owner', { ascending: false })
      .order('display_name'),
    supabase
      .from('recurring_slots')
      .select('id, contract_id, weekday, local_time, iana_tz, duration_min, active_from, active_to')
      .eq('contract_id', id)
      .order('active_from', { ascending: false }),
    supabase
      .from('contract_pauses')
      .select('contract_id, paused_on, resumed_on')
      .eq('contract_id', id)
      .order('paused_on', { ascending: false }),
    supabase.rpc('contract_credit_summary'),
    // c15 · Sol 8: a ordem do histórico é `reserved_at` (quando o pedido
    // COMEÇOU). `sent_at` deixou de servir para ordenar porque ele é nulo em
    // reserva aberta e em reserva morta — ordenar por ele jogaria justamente os
    // pedidos que pedem decisão para a ponta errada da lista.
    supabase
      .from('contract_signatures')
      .select('contract_id, id, status, provider_document_id, reserved_at, sent_at, signed_at')
      .eq('contract_id', id)
      .order('reserved_at', { ascending: false }),
    // A MESMA pergunta de `_contract_pending_count` (migration 20260718000600):
    // aula agendada cujo início já passou e ninguém disse o que aconteceu.
    supabase
      .from('class_instances')
      .select('id')
      .eq('contract_id', id)
      .eq('state', 'scheduled')
      .lt('starts_at_utc', agora.toUTC().toISO()!),
    c.renewed_from
      ? supabase.from('contracts').select('id, plan_name').eq('id', c.renewed_from).maybeSingle()
      : { data: null, error: null },
    // `.limit(1)` em vez de `.maybeSingle()`: `renewed_from` não é único no
    // banco, e uma leitura que ESTOURA porque alguém renovou duas vezes a partir
    // do mesmo contrato derrubaria a página inteira por um detalhe de rodapé.
    supabase
      .from('contracts')
      .select('id, plan_name')
      .eq('renewed_from', id)
      .order('started_on', { ascending: true })
      .limit(1),
    c.student_group_id
      ? supabase
          .from('student_group_members')
          // c12 · nº 5: `tz_confirmed` do MEMBRO entra na leitura — é dele que
          // sai o gate de fuso da turma (ver `fusoConfirmado`, mais abaixo).
          .select('student_id, students(id, display_name, iana_tz, tz_confirmed)')
          .eq('group_id', c.student_group_id)
      : vazio,
    // Destino do crédito no encerramento: contrato particular ATIVO do MESMO
    // dono (a mesma régua da tela velha; o banco confere de novo, e com mais
    // casos, em `_contracts_same_people`).
    c.student_id
      ? supabase
          .from('contracts')
          .select('id, plan_name')
          .eq('contract_type', 'private_1on1')
          .eq('status', 'active')
          .eq('student_id', c.student_id)
          .neq('id', id)
      : supabase
          .from('contracts')
          .select('id, plan_name')
          .eq('contract_type', 'private_1on1')
          .eq('status', 'active')
          .eq('student_group_id', c.student_group_id ?? '')
          .neq('id', id),
  ])

  const professoras = ProfessorasDoIndiceSchema.parse(exigir('as professoras', professorasRes) ?? [])
  const slots = SlotsDoDetalheSchema.parse(exigir('os horários fixos', slotsRes) ?? [])
  const pausas = PausasBrutasSchema.parse(exigir('as pausas', pausasRes) ?? [])
  const resumos = ResumosDeCreditoSchema.parse(exigir('o saldo de créditos', creditosRes) ?? [])
  const assinaturas = AssinaturasDoDetalheSchema.parse(exigir('as assinaturas', assinaturasRes) ?? [])
  const pendentes = (exigir('as aulas sem desfecho', pendentesRes) ?? []) as { id: string }[]
  const renovadoDe = exigir('o contrato anterior', renovadoDeRes) as {
    id: string
    plan_name: string | null
  } | null
  const renovadoPara =
    ((exigir('o contrato seguinte', renovadoParaRes) ?? []) as {
      id: string
      plan_name: string | null
    }[])[0] ?? null
  const membrosBrutos = MembrosDoGrupoSchema.parse(exigir('os membros do grupo', membrosRes) ?? [])
  const destinos = ContratosDestinoSchema.parse(exigir('os contratos-destino', destinosRes) ?? [])

  const comNome = professoras.filter((t) => t.display_name)
  const idxDaProfessora = new Map(comNome.map((t, i) => [t.id, i]))
  const professora = comNome.find((t) => t.id === c.teacher_id)

  const aluno = c.students
  const grupo = c.student_groups
  const situacao = situacaoDoContrato(c.status)

  const membros: MembroDoGrupo[] = membrosBrutos
    .map((m) => ({
      id: m.students?.id ?? m.student_id,
      nome: m.students?.display_name ?? '—',
      fuso: tzLabel(m.students?.iana_tz ?? BUSINESS_TZ),
      ancora: (m.students?.id ?? m.student_id) === c.group_tz_anchor_student,
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))

  // O FUSO QUE REGE OS HORÁRIOS deste contrato, na ordem em que o banco decide:
  // o do aluno, quando é individual; o da âncora declarada, quando é grupo; o do
  // horário que já existe, quando o grupo ainda não declarou âncora nenhuma.
  const tzDaAncora = membrosBrutos.find((m) => m.student_id === c.group_tz_anchor_student)?.students
    ?.iana_tz
  const ianaDoHorario =
    aluno?.iana_tz ?? tzDaAncora ?? slots.find((s) => !s.active_to)?.iana_tz ?? BUSINESS_TZ

  const vivos = slots.filter((s) => !s.active_to)
  const comoHorario = (s: (typeof slots)[number]): HorarioDoDetalhe => {
    const linha = slotLine(s, professora?.iana_tz ?? null)
    return {
      id: s.id,
      texto: linha.aluno,
      professora: linha.prof,
      weekday: s.weekday,
      hora: String(s.local_time).slice(0, 5),
      duracao: s.duration_min,
      ianaTz: s.iana_tz,
      fuso: tzLabel(s.iana_tz),
      vigenteDe: fmtCivilDate(s.active_from),
      encerradoEm: s.active_to ? fmtCivilDate(s.active_to) : null,
    }
  }

  const resumo = resumos.find((r) => r.contract_id === id)
  const hoje = agora.setZone(BUSINESS_TZ)

  return {
    id: c.id,
    tipo: c.contract_type,
    quem: aluno?.display_name ?? grupo?.label ?? '—',
    alunoId: aluno?.id ?? null,
    nivel: aluno?.level ?? null,
    plano: c.plan_name?.trim() || SEM_PLANO,
    produto: c.contract_type === 'mentorship' ? 'Personal Travel' : 'Aulas particulares',
    experimental: Boolean(c.is_trial),
    situacao,
    situacaoRotulo: SITUACAO_DE_CONTRATO_ROTULO[situacao],
    encerrado: situacao === 'ended',

    professora: {
      id: c.teacher_id,
      nome: professora?.display_name ?? null,
      idx: c.teacher_id ? (idxDaProfessora.get(c.teacher_id) ?? 0) : 0,
    },
    valorHora: c.hourly_rate_cents === null ? null : fmtBRL(c.hourly_rate_cents),
    valorHoraCampo: ((c.hourly_rate_cents ?? 0) / 100).toFixed(2),
    mensalidade: c.monthly_value_cents === null ? null : fmtBRL(c.monthly_value_cents),
    mensalidadeCampo: c.monthly_value_cents === null ? '' : (c.monthly_value_cents / 100).toFixed(2),
    politica: {
      remarcacoes: c.monthly_reschedule_allowance,
      avisoHoras: c.min_notice_hours,
      validadeDias: c.makeup_credit_expiry_days,
      falhaDaEscolaDias: c.school_fault_credit_expiry_days,
    },

    vigencia: {
      inicio: fmtCivilDate(c.started_on),
      fim: c.ended_on ? fmtCivilDate(c.ended_on) : null,
    },
    renovacao: {
      de: renovadoDe ? { id: renovadoDe.id, plano: renovadoDe.plan_name?.trim() || SEM_PLANO } : null,
      para: renovadoPara
        ? { id: renovadoPara.id, plano: renovadoPara.plan_name?.trim() || SEM_PLANO }
        : null,
    },
    pausas: pausas.map((p) => ({
      de: fmtCivilDate(p.paused_on),
      ate: p.resumed_on ? fmtCivilDate(p.resumed_on) : null,
      aberta: !p.resumed_on,
    })),
    pausado: pausas.some((p) => !p.resumed_on),

    grupo: grupo ? { label: grupo.label, membros } : null,
    fusoDoHorario: { iana: ianaDoHorario, rotulo: tzLabel(ianaDoHorario) },
    // c12 · nº 5: a MESMA pergunta que `_require_confirmed_tz` faz no banco —
    // "todo mundo que este contrato cobre tem cidade conferida?". No contrato
    // individual é o aluno; no de TURMA são os membros, e BASTA UM no palpite
    // para o banco recusar horário fixo. Antes, contrato de grupo lia
    // `aluno?.tz_confirmed` (sempre `null` ali) e caía no `true` do fallback:
    // a tela dizia que estava tudo certo e o Sheet morria no submit.
    fusoConfirmado: membrosBrutos.length > 0
      ? membrosBrutos.every((m) => m.students?.tz_confirmed !== false)
      : aluno
        ? aluno.tz_confirmed !== false
        : true,

    horarios: vivos.map(comoHorario),
    horariosFechados: slots.filter((s) => s.active_to).map(comoHorario),

    creditos: {
      saldo: resumo?.balance ?? null,
      proximaValidade: resumo?.next_expiry ? fmtCivilDate(resumo.next_expiry) : null,
      validadeSugeridaIso: hoje
        .plus({ days: c.makeup_credit_expiry_days ?? 90 })
        .toFormat('yyyy-LL-dd'),
      duracaoSugerida: vivos[0]?.duration_min ?? 45,
      verEm: aluno ? enderecoDaFicha(aluno.id, { aba: 'creditos' }) : null,
    },

    assinaturas: assinaturas.map((a) => ({
      id: a.id,
      status: a.status,
      rotulo: ASSINATURA_ROTULO[a.status] ?? a.status,
      documento: a.provider_document_id,
      reservadaEm: fmtLocal(a.reserved_at, BUSINESS_TZ),
      vinculadaEm: a.sent_at ? fmtLocal(a.sent_at, BUSINESS_TZ) : null,
      assinadaEm: a.signed_at ? fmtLocal(a.signed_at, BUSINESS_TZ) : null,
      // "ver status" só faz sentido enquanto o documento pode mudar de estado —
      // a mesma régua da tela velha (assinado e recusado são fim de linha) mais
      // o caso do c14: espelho SEM documento (a reserva `pending` e a reserva
      // morta `failed`) não tem o que consultar no Autentique.
      //
      // c15 · Sol 9: `expired` e `cancelled` entram na lista. Eles são terminais
      // na matriz do banco desde a 20260715000400 (`apply_autentique_event` não
      // sai de terminal nenhum), e a tela continuava oferecendo "Ver status"
      // neles: um botão que só podia devolver "nada mudou", para sempre.
      terminal: ESTADOS_TERMINAIS.has(a.status) || a.provider_document_id === null,
      reservaAberta: a.status === 'pending',
    })),

    pendencias: pendentes.length,
    destinos: destinos.map((d) => ({ id: d.id, plano: d.plan_name?.trim() || SEM_PLANO })),

    // Só a agenda da professora DESTE contrato: é a única que os painéis de
    // horário comparam, e é ela que o banco recusaria sobrepor.
    ocupacao: await lerOcupacao(supabase, ianaDoHorario, agora, {
      professoraId: c.teacher_id ?? undefined,
    }),
    hojeIso: hoje.toFormat('yyyy-LL-dd'),
    viradaMaximaIso: hoje.plus({ days: DIAS_ATE_A_VIRADA }).toFormat('yyyy-LL-dd'),
    // Comparação de STRING, e é correta de propósito: `yyyy-LL-dd` ordena
    // lexicograficamente igual à data (é o motivo de o ISO existir), e
    // `started_on` já chega do Postgres nesse formato. Nada de fabricar um
    // `DateTime` a partir de uma data civil só para escolher o maior.
    viradaMinimaIso:
      c.started_on > hoje.toFormat('yyyy-LL-dd') ? c.started_on : hoje.toFormat('yyyy-LL-dd'),
  }
}

/*
 * `lerNomeDoContrato` MORREU AQUI (c13 · nº 5).
 *
 * Ela existia para o type-to-confirm do encerramento: o c12 tirou o nome
 * esperado do formulário (era um hidden — dado de fora dos DOIS lados da
 * comparação) e o foi buscar no banco, por esta função. Só que a leitura era uma
 * consulta e o encerramento, outra: entre as duas cabia um `update students set
 * display_name`, e o portão da destrutiva grande decidia sobre um retrato. Agora
 * quem confere é `admin_end_contract(p_confirm_name, …)`, contra a linha travada
 * e dentro da mesma transação — não sobra pergunta para esta função responder.
 */
