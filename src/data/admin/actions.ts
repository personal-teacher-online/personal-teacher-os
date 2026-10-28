'use server'

// PORTA DE MUTAÇÃO DO ADMIN NOVO (Onda 1 · M1, item 1).
//
// Regra da camada: **nenhuma regra de negócio nasce aqui** (Lei 3). Cada função
// abaixo chama a MESMA RPC que a tela velha chama — quem decide crédito,
// perda, aviso mínimo e apontamento obrigatório é o Postgres. O que muda é só
// a forma do retorno: a tela velha volta por `redirect('?msg=…')`; a nova
// devolve `ResultadoDaAcao` para o toast do kit (sem `?msg=`, sem nonce).
//
// As mutações das telas dos M3/M4 (convite, pagador, vigência, pausa,
// anonimizar…) entram aqui pela mesma porta quando as telas delas nascerem —
// re-exportadas ou adaptadas, nunca reescritas.

import { revalidatePath } from 'next/cache'

import { requireAdminId } from '@/lib/auth/admin'
import { createClient } from '@/lib/supabase/server'
import type { ResultadoDaAcao } from './action-result'

const DESFECHOS = ['aconteceu', 'aluno_faltou', 'professora_faltou'] as const
type Desfecho = (typeof DESFECHOS)[number]

function ehDesfecho(v: string): v is Desfecho {
  return (DESFECHOS as readonly string[]).includes(v)
}

/**
 * Registra o desfecho de uma aula do dia (a ação contextual do andar HOJE).
 *
 * · aconteceu         → `complete_class` (exige apontamento — D2 de 20/07: ou a
 *   professora já apontou o módulo do plano, ou a admin escolhe um tema avulso)
 * · aluno_faltou      → `no_show_student` (conta como dada, sem crédito)
 * · professora_faltou → `no_show_teacher` (gera crédito de reposição)
 *
 * Devolve `ResultadoDaAcao` (o cliente mostra o toast do kit). Chamada
 * diretamente de dentro de uma transição no cliente — sem `?msg=`, sem nonce.
 *
 * `revalidar` (opcional, M3-2): a tela que chamou, quando não é o Início. A
 * ficha do aluno mostra a mesma pendência de desfecho, e sem isto o toast
 * dizia "registrada" com a linha antiga ainda na tela.
 */
export async function registrarDesfechoAction(formData: FormData): Promise<ResultadoDaAcao> {
  // Server action é endpoint público: revalida o papel SEMPRE, independente do
  // proxy (D10 da Fase 2).
  await requireAdminId()

  const instancia = String(formData.get('instance_id') ?? '')
  const desfecho = String(formData.get('desfecho') ?? '')
  if (!instancia) return { ok: false, mensagem: 'Aula não identificada.' }
  if (!ehDesfecho(desfecho)) return { ok: false, mensagem: 'Desfecho inválido.' }

  // Só caminho interno do admin entra em `revalidatePath` — o valor vem do
  // formulário, e formulário é entrada de fora.
  const daTela = String(formData.get('revalidar') ?? '')
  const tambem = daTela.startsWith('/admin/') ? daTela.split('?')[0] : null
  const revalidar = () => {
    revalidatePath('/admin')
    if (tambem) revalidatePath(tambem)
  }

  const supabase = await createClient()

  if (desfecho === 'aconteceu') {
    const { error } = await supabase.rpc('complete_class', {
      p_instance: instancia,
      p_off_kind: String(formData.get('off_kind') ?? '') || null,
      p_off_note: String(formData.get('off_note') ?? '') || null,
    })
    if (error) {
      return {
        ok: false,
        mensagem: error.message.includes('sem apontamento')
          ? 'Diga o que foi trabalhado: escolha um tema (ou a professora aponta o módulo do plano no painel dela).'
          : `Não deu para registrar: ${error.message}`,
      }
    }
    revalidar()
    return { ok: true, mensagem: 'Aula registrada como realizada.' }
  }

  const { error } = await supabase.rpc(
    desfecho === 'professora_faltou' ? 'no_show_teacher' : 'no_show_student',
    { p_instance: instancia },
  )
  if (error) return { ok: false, mensagem: `Não deu para registrar: ${error.message}` }

  revalidar()
  // A5, afirmação falsa nº 4: este toast AFIRMAVA "o aluno ganhou um crédito de
  // reposição". Pode ser falso — `_mark_no_show` chama
  // `_refund_for_credit_born_class`, que volta SEM creditar quando o gasto não
  // tem identidade (`consumes_ledger_id is null` → só via ajuste manual). A
  // frase da Agenda LÊ a trilha para saber o que houve; esta tela não lê, então
  // ela admite a exceção em vez de inventar a resposta. Ler a trilha aqui é
  // estrutura, não texto: roteado para a onda do Início.
  return {
    ok: true,
    mensagem:
      desfecho === 'professora_faltou'
        ? 'Falta da professora registrada — a hora não conta no extrato dela. Em regra o aluno ganha um crédito de reposição; a exceção é a aula que nasceu de um crédito antigo sem identidade, em que o sistema não devolve sozinho — nesse caso confira o extrato de créditos dele na ficha.'
        : 'Falta do aluno registrada — a aula conta como dada: a hora conta no extrato da professora, e o aluno não ganha crédito.',
  }
}
