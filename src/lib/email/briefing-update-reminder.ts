import { BRAND_BTN_STYLE, brandEmail } from './brand'
import { escapeHtml } from './credit-expiry'
import { WA_FOOTER } from './class-notices'

// Briefing v2 · sub-lote 5 (28/07/2026) — lembrete do RE-BRIEFING SEMESTRAL
// (template 'briefing-update-reminder', disparado pela dona na ficha do aluno).
//
// Irmão do 'briefing-reminder', com a diferença que a pessoa precisa sentir: lá
// falta um passo para começar; aqui já faz meses que ela estuda, e o convite é
// para contar o que mudou. Nada de "pendência", nada de cobrança — é rápido,
// são duas etapas, e o texto diz isso. Mesma régua de tom: transacional
// positiva, 1 emoji no máximo, zero jargão (nem "briefing v2", nem "semestre 2
// do contrato").

const APP_URL_DEFAULT = 'https://app.personal-teacher.com'

export interface BriefingUpdateReminderFacts {
  firstName: string
  appUrl?: string
}

export function briefingUpdateReminderEmail(f: BriefingUpdateReminderFacts): {
  subject: string
  html: string
} {
  const appUrl = f.appUrl ?? APP_URL_DEFAULT
  return {
    subject: 'Novo semestre: o que mudou nos seus objetivos? 🎯',
    html: brandEmail(`
<p>Olá, ${escapeHtml(f.firstName)}!</p>
<p>Começa um semestre novo das suas aulas — e é hora de conferir se o inglês que
você quer hoje ainda é o mesmo de quando você começou. São duas telas rápidas:
os seus <strong>objetivos</strong> e os seus <strong>interesses</strong>.</p>
<p>As suas respostas de antes já estão lá, preenchidas: confirme o que continua
valendo e mude só o que mudou. É com isso que a sua professora monta o plano
deste semestre.</p>
<p>
  <a href="${escapeHtml(appUrl)}/portal/briefing/atualizar" style="${BRAND_BTN_STYLE}">Atualizar meus objetivos</a>
</p>
<p>Um abraço,<br />Equipe Personal Teacher Academy</p>`),
  }
}

export function briefingUpdateReminderText(f: BriefingUpdateReminderFacts): string {
  const appUrl = f.appUrl ?? APP_URL_DEFAULT
  return (
    `Olá, ${f.firstName}! Começa um semestre novo das suas aulas: conte para a gente o que mudou nos seus objetivos e interesses. 🎯\n\n` +
    `São duas telas rápidas, com as suas respostas de antes já preenchidas — confirme o que continua valendo e mude só o que mudou.\n\n` +
    `Atualizar agora:\n${appUrl}/portal/briefing/atualizar\n\n` +
    WA_FOOTER +
    `Equipe Personal Teacher Academy`
  )
}
