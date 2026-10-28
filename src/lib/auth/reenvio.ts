// O REENVIO DO CONVITE, sem a mentira do silêncio (Onda do Portal · P5).
//
// A DÍVIDA c14 QUE MORRE AQUI. A action de `/convite-expirado` lia o aluno por
// `_student_by_email` e DESCARTAVA o `error` do PostgREST: com o banco fora do
// ar, `studentId` vinha nulo, nenhum convite era enviado e a tela dizia, com
// todas as letras, "um link novo acabou de ser enviado". A pessoa que já não
// consegue entrar ficava esperando um e-mail que ninguém mandou — e voltava
// horas depois para a mesma frase.
//
// A NEUTRALIDADE CONTINUA INTEIRA, e é por isso que os dois erros têm destinos
// diferentes:
//
//   · FALHA DE LEITURA (a RPC não respondeu) não depende do e-mail digitado —
//     ela acontece para todo mundo, cliente ou não. Contá-la não revela nada e
//     é a única coisa verdadeira que a tela sabe. Vira 'nao-deu'.
//   · FALHA DO PROVISIONAMENTO acontece SÓ para quem existe, e é parcialmente
//     provocável de fora: basta repetir o mesmo e-mail até o Auth impor limite
//     de envio. Se ela mudasse a resposta, o formulário viraria um enumerador de
//     clientes ("este e-mail começou a falhar ⇒ este e-mail é cliente"). Ela
//     continua no log e na resposta NEUTRA, como sempre esteve.
//
// A função recebe o provisionador por parâmetro para que o teste possa exercitar
// os quatro caminhos sem tocar no GoTrue.
import type { SupabaseClient } from '@supabase/supabase-js'

export type DesfechoDoReenvio = 'enviado' | 'nao-deu'

export async function reenviarConvite(
  admin: SupabaseClient,
  emailCru: string,
  provisionar: (admin: SupabaseClient, studentId: string, email: string) => Promise<unknown>,
): Promise<DesfechoDoReenvio> {
  const email = emailCru.trim().toLowerCase()
  // E-mail malformado nunca chega ao banco — e a resposta é a neutra, porque
  // "digitei errado" e "não sou cliente" não podem ser distinguíveis.
  if (!email.includes('@')) return 'enviado'

  const { data: studentId, error } = await admin.rpc('_student_by_email', { p_email: email })
  if (error) {
    console.error('[reenvio de convite] leitura falhou', error.message)
    return 'nao-deu'
  }
  if (!studentId) return 'enviado'

  try {
    await provisionar(admin, String(studentId), email)
  } catch (err) {
    // Neutro de propósito (ver o cabeçalho): o log é nosso, a resposta é a mesma.
    console.error('[reenvio de convite] provisionamento falhou', err)
  }
  return 'enviado'
}
