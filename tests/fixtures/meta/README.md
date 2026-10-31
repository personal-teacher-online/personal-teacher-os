# Fixtures da Cloud API da Meta (envio de template, #43)

Consumidas por `tests/m3-cloud-api.test.ts`. Não há produção para amostrar
ainda (o número da escola na Meta não mandou nada): cada arquivo tem a forma
DOCUMENTADA pela Meta, com a URL da documentação e a data da leitura na chave
`_fonte` (o teste a ignora). Quando o primeiro envio real acontecer (runbook
§AN), o request e a resposta reais substituem estes arquivos.

| Arquivo | O que é |
|---|---|
| `send-template-request.json` | o corpo do `POST /<versão>/<id do número>/messages` para o aviso de aula cancelada sem crédito. `<to>`, `<dia_e_hora>` e `<attempt_id>` são trocados pelo teste (dependem do aluno, do relógio e da tentativa) |
| `send-template-response.json` | a resposta de sucesso; `messages[0].id` é o wamid que o despachante grava. O teste acrescenta um sufixo por rodada ao id, porque o banco não aceita o mesmo id do provedor em duas linhas |
| `send-template-error.json` | a resposta de erro da Graph API (template inexistente no idioma), servida com HTTP 400 |

Telefones na faixa fictícia `+55 65 9000X-XXXX`; nomes inventados.
