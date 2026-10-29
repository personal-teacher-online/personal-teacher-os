// JSON DE SUBMISSÃO DOS TEMPLATES DE WHATSAPP À META (ADR-038 · issue #41).
//
// Imprime um objeto por template (`name`, `language`, `category`, `components`
// com o `BODY` e o `example`), no formato de `POST /{waba}/message_templates`.
// A fonte é `src/lib/notify/whatsapp-templates.ts`; este script não tem texto.
// A cópia versionada em `docs/ops/whatsapp-templates.json` tem de ser idêntica
// à saída (o teste `tests/whatsapp-templates.test.ts` compara byte a byte).
//
// Uso:
//   npm run -s whatsapp:templates                                  (imprime)
//   npm run -s whatsapp:templates > docs/ops/whatsapp-templates.json (regenera)
//
// A submissão em si é o passo AN.6 do runbook, feito à mão pelo dono, depois de
// a dona responder a revisão dos textos (M3-4).

import { jsonDeSubmissao } from '@/lib/notify/whatsapp-templates'

process.stdout.write(jsonDeSubmissao())
