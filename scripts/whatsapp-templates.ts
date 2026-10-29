// JSON DE SUBMISSÃO DOS TEMPLATES DE WHATSAPP À META (ADR-038 · issue #41).
//
// Imprime uma LISTA JSON com um elemento por template (`name`, `language`,
// `category`, `components` com o `BODY` e o `example`). Cada elemento é o corpo
// de UMA chamada `POST /{waba}/message_templates`: a Meta cria um template por
// chamada, e mandar a lista inteira de uma vez falha. A fonte é
// `src/lib/notify/whatsapp-templates.ts`; este script não tem texto.
// A cópia versionada em `docs/whatsapp-templates.json` tem de ser idêntica à
// saída (o teste `tests/whatsapp-templates.test.ts` compara byte a byte).
//
// Uso:
//   npm run -s whatsapp:templates                               (imprime)
//   npm run -s whatsapp:templates > docs/whatsapp-templates.json (regenera)
//
// Submeter (passo AN.6 do runbook, à mão pelo dono, depois de a dona responder
// a revisão dos textos, M3-4): um POST por elemento, por exemplo
//   jq -c '.[]' docs/whatsapp-templates.json | while read -r t; do
//     curl -sS -X POST "https://graph.facebook.com/<versão>/<id da WABA>/message_templates" \
//       -H "Authorization: Bearer $WHATSAPP_CLOUD_TOKEN" -H 'Content-Type: application/json' -d "$t"
//   done

import { jsonDeSubmissao } from '@/lib/notify/whatsapp-templates'

process.stdout.write(jsonDeSubmissao())
