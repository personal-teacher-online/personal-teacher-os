// AS RECUSAS DO BANCO QUE A PROFESSORA LÊ — o módulo PURO (M2 · A4 do gate Sol).
//
// O banco recusa com texto técnico (nome de constraint, "conflicting key value
// violates exclusion constraint…", inglês). A professora nunca lê esse texto: a
// recusa que a regra conhece vira frase de gente, e a que NINGUÉM mapeou vira
// uma frase genérica e honesta. O texto cru vai para o log do servidor (quem
// chama decide), nunca para a tela.
//
// Sem `server-only` nem cliente do Supabase: testável linha a linha.

/** Quando nada casa. Começa com "Falha" para o toast pintar de erro. */
export const RECUSA_DESCONHECIDA =
  'Falha: não consegui concluir agora. Nada foi alterado — tente de novo e, se repetir, avise a administração.'

/** A recusa do banco vira frase. Texto cru NUNCA volta daqui. */
export function fraseDaRecusa(m: string): string {
  // As mais específicas primeiro: o horário em contrato em pausa e o bloqueio
  // são recusas DETERMINÍSTICAS — "tente de novo" faria a professora repetir
  // o mesmo erro sem saber o porquê.
  if (m.includes('EM PAUSA')) return 'Esse horário é de um contrato em pausa — escolha outro.'
  if (m.includes('só se aplica a contratos private_1on1')) return 'Essa ação só vale para aulas particulares.'
  if (m.includes('janela semanal') && m.includes('não existe')) return 'Essa janela semanal já não existe — recarregue a página.'
  if ((m.includes('instância') || m.includes('janela')) && m.includes('não existe')) {
    return m.includes('janela') ? 'Essa janela já não existe — recarregue a página.' : 'Essa aula não existe mais.'
  }
  // Constraints que a tela não antecipa: a professora que repete a ação toca no mesmo índice/CHECK.
  if (m.includes('reschedule_windows_teacher_slot_uniq')) return 'Você já publicou uma janela nesse horário.'
  if (m.includes('tw_avail_order'))
    return 'O fim precisa vir depois do início. Janela que passa da meia-noite: divida em duas.'
  if (m.includes('aula não encontrada')) return 'Essa aula não existe mais.'
  if (m.includes('exceção') && m.includes('não existe')) return 'Esse bloqueio já não existe — recarregue a página.'
  if (m.includes('não é um bloqueio')) return 'Esse item não é um bloqueio.'
  if (m.includes('período invertido')) return 'O período está invertido: a data final vem antes da inicial.'
  if (m.includes('bloqueio da professora') || m.includes('bloqueado pela professora'))
    return 'Esse horário está dentro de um bloqueio seu — remova o bloqueio antes ou escolha outro.'
  if (m.includes('já tem aula marcada nesse horário'))
    return 'Você já tem aula marcada nesse horário — nenhum aluno conseguiria reservar essa janela.'
  if (m.includes('janela') && m.includes('não está publicada')) return 'Essa janela já não está publicada.'
  if (m.includes('janela') && m.includes('não está disponível')) return 'Essa janela já não está disponível.'
  if (m.includes('é da própria professora') || m.includes('professora só publica janela PARA SI'))
    return 'Só a própria professora ou a administração mexe nessa agenda.'
  if (m.includes('apenas admin ou a professora')) return 'Só a professora do aluno ou a administração pode fazer isso.'
  if (m.includes('item de plano não encontrado')) return 'Esse módulo já não existe — recarregue a página.'
  if (m.includes('módulo apontado é de outro')) return 'Esse módulo é de outro aluno.'
  if (m.includes('exatamente um')) return 'Escolha um módulo do plano OU descreva um tema avulso — só um dos dois.'
  if (m.includes('defina o nível do aluno')) return 'Defina o nível do aluno na ficha antes de gerar o plano.'
  if (m.includes('não há trilha cadastrada')) return 'Não há trilha cadastrada para o nível desse aluno — fale com a administração.'
  if (m.includes('não é sua')) return 'Essa aula não é sua.'
  if (m.includes('só a professora ou a administração')) return 'Só a professora ou a administração pode fazer isso.'
  if (m.includes('próximas 2 semanas')) return 'O novo horário precisa estar nas próximas 2 semanas.'
  if (m.includes('não está vinculada')) return 'Sua conta não está vinculada a uma professora.'
  if (m.includes('exige motivo')) return 'Escreva o motivo — ele vai para a administração.'
  if (m.includes('motivo longo')) return 'O motivo ficou longo demais (máximo 500 caracteres).'
  if (m.includes('já começou')) return 'Essa aula já começou — registre o desfecho com a administração.'
  if (m.includes('não está agendada')) return 'Essa aula já não está agendada.'
  if (m.includes('aviso mínimo'))
    return 'A aula já está dentro do aviso mínimo do contrato — remarcar não é mais possível. Se precisar, cancele: o aluno ganha crédito.'
  if (m.includes('antecedência')) return 'O novo horário exige mais antecedência — escolha um horário mais à frente.'
  if (m.includes('não está disponível')) return 'Você não está disponível nesse horário — escolha outro.'
  if (m.includes('publicado para reposição')) {
    // O banco nomeia a janela no relógio de quem publicou ('2026-11-03 19:00 America/Sao_Paulo').
    const q = m.match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})/)
    const qual = q ? ` de ${q[3]}/${q[2]} às ${q[4]}` : ''
    return `Esse horário encosta no seu horário de reposição publicado${qual} — despublique antes ou escolha outro.`
  }
  if (m.includes('já passou')) return 'Esse horário já passou.'
  if (m.includes('teacher_no_overlap') || m.includes('conflicting key') || m.includes('exclusion'))
    return 'Você já tem aula nesse horário.'
  if (m.includes('contrato') && m.includes('não está ativo')) return 'O contrato desse aluno não está ativo.'
  return RECUSA_DESCONHECIDA
}

/**
 * A frase que VAI PARA A TELA. `contexto` troca o "Falha" do começo ("Falha ao
 * apontar"). Recusa que ninguém mapeou sai genérica e o texto cru vai para o
 * `log` (o `console.error` do servidor) — nunca para quem lê a tela.
 */
export function recusaParaTela(
  erro: { message: string },
  contexto = 'Falha',
  log: (...args: unknown[]) => void = console.error,
): string {
  const frase = fraseDaRecusa(erro.message)
  if (frase === RECUSA_DESCONHECIDA) {
    log('[professora · recusa não mapeada]', erro.message)
    return RECUSA_DESCONHECIDA
  }
  return `${contexto}: ${frase}`
}
