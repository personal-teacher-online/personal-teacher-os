// TOM DO RECADO PENDURADO NA URL — a parte PURA da ponte `?msg=` → toast.
//
// As ações VELHAS (admin e portal) terminam em `redirect('…?msg=…&n=…')` e não
// carregam campo de status: o tom precisa ser lido da própria frase.
//
// A RÉGUA VIROU (revisão adversarial P1 · F2). Antes o erro era reconhecido por
// dois começos ("Falha…", "Não deu…") e TODO o resto virava verde. Só que a
// maioria das recusas do portal não abre com nenhum dos dois — "Você não tem
// crédito suficiente para este agendamento.", "Esse horário acabou de ser
// reservado por outra pessoa — escolha outro.", "Faltam menos de 24h…" — e o
// aluno lia a recusa em VERDE, com o ✓ da casa. O admin tinha o mesmo defeito
// ("Aluno inválido.", "Escolha um pagador.", "Contrato não encontrado.").
//
// Agora quem é enumerado é o SUCESSO: as frases de acerto são poucas, fixas e
// escritas por nós; qualquer coisa fora da lista é tratada como erro. Errar para
// o vermelho custa um susto; errar para o verde esconde uma falha de dinheiro,
// de horário ou de crédito.
//
// COMO ISSO NÃO APODRECE: `tests/portal-nav.test.ts` lê NA FONTE os SEIS
// módulos de ação cujas frases chegam ao `AvisoLegado` — portal, ficha do aluno,
// admissão, contratos, créditos e agenda —, extrai toda frase e cobra a
// classificação de cada uma. Frase nova sem lista = teste vermelho.
//
// P5: o PORTAL não alimenta mais `?msg=` nenhum — as frases dele viajam no
// cookie de flash e a moldura as entrega a este mesmo `AvisoLegado`. A régua
// continua valendo igual: o que muda é o transporte, não quem escolhe a cor. Os
// cinco módulos do admin seguem na ponte da URL até a onda das telas deles.
//
// Quem pinta é o `AvisoLegado` (kit, cliente); quem DECIDE é esta função — sem
// DOM, testável linha a linha.
//
// ⚠️ O `FlashMsg` legado (`src/components/ui.tsx`) continua com a régua ANTIGA,
// e eles divergem de propósito: o FlashMsg serve telas do admin cujas frases
// ninguém enumerou aqui (pagamentos, conteúdo, relatórios, professoras,
// mentoria, avisos). Migrá-lo é trabalho da onda daquelas telas.
//
// A AGENDA ENTROU NA LISTA por uma porta lateral, e é bom saber qual: a ficha do
// aluno reusa `cancelClassAction` de `src/app/admin/agenda/actions.ts` (painel
// "cancelar", `paineis.tsx`) e a ficha pinta por `AvisoLegado`. Enumerado o
// cancelamento, enumeramos o módulo inteiro — deixar meia dúzia de sucessos da
// agenda de fora seria guardar, por escrito, um vermelho para o dia em que
// aquela tela migrar.
//
// Isto é ponte de convivência, não padrão novo: tela nova devolve
// `ResultadoDaAcao` e fala por toast (ADR-025), sem `?msg=` nenhum.

export type TomDoAviso = 'erro' | 'sucesso'

/**
 * AS FRASES DE ACERTO, uma a uma — string = começo da frase; RegExp para o
 * punhado que tem dado no meio (`Aluno ${nome} criado.`).
 *
 * Regra de manutenção: o que entra aqui é ato CONCLUÍDO como a pessoa pediu.
 * Sucesso parcial ("Pagador criado, mas o vínculo falhou: …") fica de fora de
 * propósito — ele conta uma falha, e falha é vermelha.
 */
const FRASES_DE_SUCESSO: readonly (string | RegExp)[] = [
  // ---- portal do aluno (`src/app/portal/actions.ts`) ----
  // Os dois primeiros vão SEM pontuação de propósito: a mesma aula é remarcada e
  // cancelada por duas portas que pontuam diferente — o portal diz "Aula
  // remarcada! ✅ …" / "Aula cancelada. Você recebe…" e a agenda (reusada pela
  // ficha) diz "Aula remarcada. O aluno recebe…" / "Aula cancelada — o aluno
  // GANHOU um crédito…". Nenhuma frase de FALHA dos dois módulos começa com
  // "Aula remarcada" ou "Aula cancelada", então o prefixo curto não abre porta.
  'Aula remarcada',
  'Aula cancelada',
  'Reposição agendada!',
  'Presença confirmada',
  'Reserva cancelada',
  'Mentoria reservada!',
  'Número atualizado.',
  'Senha trocada.',
  'Briefing enviado!',
  // re-briefing semestral (briefing v2 · sub-lote 4)
  'Atualização enviada!',

  // ---- admin · alunos (`admin/alunos/actions.ts`, `admin/alunos/novo/actions.ts`) ----
  /^Aluno .+ criado/i,
  'Aluno anonimizado',
  /^Lead .+ criado/i,
  'Lead marcado como perdido',
  'Cadastro atualizado.',
  'Fuso atualizado.',
  'Convite enviado!',
  'Convite reenviado.',
  'Este aluno já está com o acesso ativo.',
  'WhatsApp do aluno atualizado.',
  'Nota interna salva.',
  'Nota interna apagada.',
  'Pagador vinculado.',
  // F3 — os dois sentidos são ato concluído como pedido (mudar o vínculo):
  'Pagador marcado como o próprio aluno',
  'Pagador marcado como terceiro',
  'Pagador criado e vinculado.',
  'Vínculo removido.',
  'Login bloqueado e credenciais embaralhadas.',
  'Briefing preenchido e finalizado',
  'Briefing salvo como rascunho',
  'Correção registrada',
  'Lembrete de briefing a caminho',
  // re-briefing semestral (briefing v2 · sub-lote 5)
  'Lembrete de atualização a caminho',
  'Lembrete de hoje já tinha sido enviado',
  'Plano do semestre gerado',

  // ---- admin · contratos e créditos (`admin/contratos/actions.ts`, `admin/credit-actions.ts`) ----
  'Contrato criado',
  /^Contrato e .+ criados/i,
  'Contrato encerrado',
  'Contrato renovado',
  'Contrato pausado',
  'Contrato reativado',
  'Contrato enviado para assinatura',
  'Regras atualizadas',
  // Onda Financeiro · F2 — o painel da mensalidade (previsto v3). "Despublicada"
  // é ato concluído como pedido (campo vazio = despublicar), não falha.
  'Mensalidade salva.',
  'Mensalidade despublicada',
  'Slot criado',
  'Horário alterado',
  'Crédito ajustado',
  'Validade estendida',
  'Documento anexado à reserva',
  'Ainda sem movimento nesta assinatura',
  'Status atualizado:',

  // ---- admin · agenda (`admin/agenda/actions.ts`) — ver a nota do cabeçalho --
  'Aula registrada como realizada',
  'Aula avulsa criada',
  'Aula experimental criada',
  // O lote "todas aconteceram" ABRE COM A CONTAGEM (`${n} aula(s) registrada(s)
  // como realizada(s). ✓`) — não há prefixo fixo para casar, daí a expressão.
  /^\S+ aula\S* registrada\S* como realizada/i,
  // "Falta" sozinho seria porta escancarada — o portal recusa com "Falta definir
  // o critério desta etapa…". O que é sucesso é o REGISTRO da falta.
  'Falta da professora registrada',
  'Falta do aluno registrada',
  'Horário publicado',
  'Horário despublicado',
  // F5 (Onda Financeiro) — emissão de cobrança da aula avulsa pelo balão.
  // Adoção também é ato concluído: a cobrança existe e o espelho ficou íntegro.
  'Cobrança emitida no Asaas',
  'Uma cobrança desta aula já existia no Asaas',
  'Período tratado:',
  // A3 (onda da Agenda) — disponibilidade e bloqueios da professora
  'Janela semanal criada',
  'Janela semanal removida.',
  'Bloqueio criado',
  'Bloqueio removido',

  // ---- admin · ajustes (`admin/ajustes/actions.ts`) — A8 da onda da Agenda --
  // A tela nasce nova, mas a ação dela entra pela mesma ponte da seção
  // (`?msg=` + nonce → AvisoLegado → toast): o transporte da Agenda morre por
  // formulário, e este é mais um deles. Sem esta linha, o acerto sairia
  // VERMELHO — o default da régua.
  'Política da professora atualizada.',

  // ---- admin · pauta de conteúdo (`admin/conteudo/pauta/actions.ts`) — M4 ----
  // Tela nova, mesmo transporte de cookie da seção. As duas últimas trazem
  // travessão + consequência: nenhuma casa com os marcadores de falha parcial
  // (o gatilho é o "mas", não o traço), e o teste do varredor cobra isso.
  'Criador adicionado à pauta.',
  'Criador atualizado.',
  'Criador desativado',
  'Criador reativado',

  // ---- admin · radar de trends (`admin/conteudo/radar/actions.ts`) — Leva 3 --
  // Descartar É o ato pedido (triagem): concluído como a dona mandou, verde.
  // O travessão + consequência não dispara o marcador de falha parcial (o
  // gatilho é o "mas", não o traço) — mesmo precedente da Pauta.
  'Trend descartada',
  // Leva 4: o ajuste da nota (a válvula da dona) — definir e limpar são os
  // dois atos completos do painel; o travessão + consequência segue o mesmo
  // precedente (nenhuma casa com os marcadores de falha parcial).
  'Nota de viagem ajustada',
  'Ajuste de nota removido',
  // Leva 5: "Gerar roteiro" quando o teto do dia já passou. NÃO é sucesso
  // parcial — nada falhou: a trend foi aprovada, o roteiro foi pedido e a
  // vassoura da manhã o gera. Vermelho aqui diria "deu errado", que é mentira.
  // (O sucesso com rascunho na mão não passa por esta lista: ele redireciona
  // para o detalhe do post, que tem a régua própria dele.)
  'Roteiro na fila:',
  // Leva 5: o sucesso com rascunho na mão cai no DETALHE DO POST, que ainda
  // pinta pelo `FlashMsg` (regex `^falha|^não deu`). A frase entra aqui para as
  // duas réguas darem a MESMA resposta — as outras saídas dessa action começam
  // com "Falha", então nenhuma delas cai neste verde por engano.
  'Rascunho gerado',

  // ---- painel da professora (`teacher/actions.ts`, rotas `teacher/google/*`) --
  // Issue #32: o desfecho dela saiu da URL (`?msg=`) e entrou no cookie de flash,
  // lido pelo MESMO AvisoLegado. Sem estas linhas, todo acerto dela sairia
  // VERMELHO — o default da régua. ('Janela semanal …', 'Bloqueio …' e
  // 'Aula remarcada/cancelada' já estão acima.)
  'Janela publicada',
  'Janela cancelada.',
  'Google Agenda conectada',
  'Google Agenda desconectada',
  'O Google Agenda já estava desconectado.',
  'Plano do semestre pronto',
  'Módulo atualizado.',
  'Sugestões prontas',
  'Conteúdo da aula apontado.',
  // O retorno do Google em que ELA cancela a tela de consentimento: ato dela, nada falhou.
  'Conexão cancelada',
]

/**
 * SUCESSO PARCIAL NÃO É SUCESSO (revisão adversarial P1 · G2/G3).
 *
 * Algumas ações concluem o ato principal e falham no acessório, e a frase
 * resultante COMEÇA como um acerto enumerado acima: "Aluno Marina criada, mas a
 * cidade não foi confirmada: timeout" casa com `/^Aluno .+ criado/`, e
 * "Convite enviado! 🎉 (WhatsApp não salvo — corrija na ficha)" casa com
 * "Convite enviado!". Pelo começo, as duas saíam VERDES — com o ✓ da casa em
 * cima de um fuso não conferido e de um telefone que ninguém tem.
 *
 * Por isso estes marcadores são consultados ANTES da lista de acertos e têm a
 * palavra final. Eles são conferidos, um a um, contra TODAS as frases de sucesso
 * enumeradas (`tests/portal-nav.test.ts` cobra isso na fonte): nenhuma as
 * contém, e frase de sucesso nova que passe a conter uma delas aparece como
 * teste vermelho — o conserto é o marcador, nunca a frase.
 */
const MARCAS_DE_FALHA_PARCIAL: readonly RegExp[] = [
  // O separador deixou de ser só a VÍRGULA (onda da Agenda · A1). A frase
  // "Aula remarcada — mas o aviso ao aluno NÃO saiu" foi escrita com travessão
  // e escapou do marcador: ela casa com o prefixo de sucesso "Aula remarcada" e
  // saía VERDE, com o ✓ da casa, anunciando um aviso que nunca foi enviado.
  // Quem escreve um "mas" está confessando uma falha — o sinal de pontuação
  // antes dele é acidente de estilo, não de sentido.
  /[,—–-]\s*mas\s/i,
  /não\s+salvo/i,
  /não\s+foi\b/i,
  /não\s+saiu\b/i,
  /falhou/i,
  // Janela publicada, mas a checagem do Google não rodou: o ato principal ficou, o
  // acessório (conferir o compromisso pessoal dela) não — falha parcial, vermelha.
  /não\s+consegui\b/i,
]

export function tomDoAviso(mensagem: string): TomDoAviso {
  const frase = mensagem.trim()
  if (MARCAS_DE_FALHA_PARCIAL.some((m) => m.test(frase))) return 'erro'
  const acertou = FRASES_DE_SUCESSO.some((p) =>
    typeof p === 'string' ? frase.toLowerCase().startsWith(p.toLowerCase()) : p.test(frase),
  )
  return acertou ? 'sucesso' : 'erro'
}
