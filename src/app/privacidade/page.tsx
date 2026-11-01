// Política de privacidade PÚBLICA (sem login). É a URL que a Meta exige para
// publicar o app do WhatsApp (ADR-038, passo AN.5) e, na âncora `#exclusao`,
// as instruções de exclusão de dados. Rota pública em `src/lib/auth/gate.ts`.
//
// `force-dynamic`: razão social e CNPJ vêm de env lida a cada requisição; sem
// isto o Next congelaria no build o valor que a env tinha na hora de buildar.
import type { Metadata } from 'next'

import { PoliticaDePrivacidade } from '@/components/privacidade/PoliticaDePrivacidade'
import { controladoraDe } from '@/lib/privacidade'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Política de Privacidade · Personal Teacher Academy',
  description:
    'Como a Personal Teacher Academy trata os dados de alunas, professoras e responsáveis, e como pedir cópia ou exclusão.',
  robots: { index: true, follow: true },
}

export default function PrivacidadePage() {
  return <PoliticaDePrivacidade controladora={controladoraDe(process.env)} />
}
