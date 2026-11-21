// O AVISO DE COMPROMISSO DO GOOGLE AO PUBLICAR HORÁRIO ABERTO (issue #190).
//
// A dona publicava um horário aberto em cima de um compromisso pessoal da
// professora e a aluna não o via no portal: a grade de lá tira o que cruza o
// ocupado do Google (`src/lib/portal/computed-slots.ts`). Nada avisava a dona.
// Agora a publicação PARA e pergunta; ela pode publicar mesmo assim ou voltar.
//
// Isto é ANTECIPAÇÃO para a dona, não regra (Lei 3): quem publica continua sendo
// `publish_reschedule_window`, e quem decide o que a aluna vê continua sendo o
// portal. Por isso a confirmação pode viajar no formulário: forjá-la só pula um
// aviso.
//
// MÓDULO PURO de propósito: o balão do slot é `'use client'` e precisa da frase
// e do nome do campo; a leitura do Google mora em
// `src/lib/google/compromisso-ao-publicar.ts`, que é servidor.

/** O campo que carrega a confirmação: sai no botão "Publicar mesmo assim" e
 *  volta no rascunho quando a publicação parou para avisar. */
export const CAMPO_DO_AVISO_DO_GOOGLE = 'aviso_google'

/** A frase do aviso, como o dono aprovou na issue #190. */
export const AVISO_DO_GOOGLE_AO_PUBLICAR =
  'A professora tem um compromisso na agenda do Google neste horário. Enquanto ele existir, a aluna não vai ver este horário.'

/** O texto do botão que publica depois do aviso. */
export const PUBLICAR_MESMO_ASSIM = 'Publicar mesmo assim'

/**
 * A FICHA do aviso: de qual professora e de qual instante ele fala.
 *
 * A confirmação só vale para o horário que foi avisado. Se a dona trocar a
 * professora, a data ou a hora depois do aviso, a ficha que o botão manda deixa
 * de bater com a do envio, e a publicação confere o Google de novo em vez de
 * passar direto.
 */
export function fichaDoAvisoDoGoogle(teacherId: string, instanteUtc: string): string {
  return `${teacherId}|${instanteUtc}`
}

/** A professora de quem a ficha fala (o balão esconde o aviso quando a dona
 *  troca a professora no seletor). */
export function professoraDaFicha(ficha: string | undefined): string | null {
  if (!ficha) return null
  const corte = ficha.indexOf('|')
  return corte > 0 ? ficha.slice(0, corte) : null
}
