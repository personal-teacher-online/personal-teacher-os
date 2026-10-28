// Regra de lint: FUSO NÃO SE CALCULA NO CLIENTE (Onda 1 · M1, item 6 — Lei 1).
//
// Em arquivo `"use client"`, `new Date(…)`, `x.toLocaleString(…)` (e irmãos),
// `Intl.DateTimeFormat` e as bibliotecas de data resolvem no fuso do NAVEGADOR
// — o fuso que o domínio não tem. A recorrência é hora local + zona IANA; a
// instância é UTC; quem converte é o servidor (Luxon com a zona do
// aluno/negócio), e o cliente recebe TEXTO pronto
// (`src/components/kit/instant.tsx`).
//
// EXCEÇÃO com justificativa OBRIGATÓRIA:
//   · na linha de cima  →  `// fuso-ok: <motivo>`
//   · no arquivo todo   →  `// fuso-ok-arquivo: <motivo>` (para o caso raro em
//     que comparar com o relógio do navegador É a função do componente)
// Um `eslint-disable` comum também silencia (é o ESLint), mas o `fuso-ok:`
// exige o motivo escrito — que é o ponto: o desvio da Lei 1 fica assinado.
//
// ---------------------------------------------------------------------------
// ENDURECIMENTO da revisão adversarial nº 1 (C8). O revisor EXECUTOU a regra e
// provou três escapes e um falso positivo:
//
//   escapes    · `Date()` sem `new` (devolve string no fuso do navegador);
//              · `new globalThis.Date(…)` / `new window.Date(…)`;
//              · `Intl['DateTimeFormat']` (acesso computado);
//              · `import { DateTime } from 'luxon'` num módulo cliente — a
//                biblioteca inteira passava batida, e `DateTime.now()` no
//                navegador é exatamente o que a Lei 1 proíbe.
//   falso      · `new Date(iso).getTime()` e `+new Date(iso)` NÃO formatam
//   positivo     nada: são aritmética de época, iguais em qualquer fuso. Punir
//                isso empurra quem escreve para o `eslint-disable` — e o
//                disable, uma vez aceso, esconde também o que importa.
// ---------------------------------------------------------------------------

const PROIBIDOS_LOCALE = new Set(['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'])

/** Objetos globais por onde `Date`/`Intl` também são alcançáveis. */
const GLOBAIS = new Set(['globalThis', 'window', 'self'])

/** Conversões para época: puras, iguais em qualquer fuso. */
const EPOCA = new Set(['getTime', 'valueOf'])

/** Bibliotecas de data: no cliente, elas resolvem no fuso do navegador. */
const BIBLIOTECAS = /^(luxon|date-fns($|\/|-))/

const JUSTIFICATIVA = /fuso-ok:\s*\S/
const JUSTIFICATIVA_ARQUIVO = /fuso-ok-arquivo:\s*\S/

/** Nome da propriedade, com ou sem colchete (`a.b` e `a['b']`). */
function nomeDaPropriedade(node) {
  if (!node.computed) return node.property.type === 'Identifier' ? node.property.name : null
  return node.property.type === 'Literal' && typeof node.property.value === 'string'
    ? node.property.value
    : null
}

/**
 * Nome do objeto, atravessando UM salto de global: `Intl` e `globalThis.Intl`
 * (ou `globalThis['Intl']`) são a mesma coisa.
 */
function nomeDoObjeto(node) {
  if (node.type === 'Identifier') return node.name
  if (node.type === 'MemberExpression' && node.object.type === 'Identifier') {
    return GLOBAIS.has(node.object.name) ? nomeDaPropriedade(node) : null
  }
  return null
}

/** `new Date(x).getTime()` / `new Date(x).valueOf()` / `+new Date(x)`. */
function soEpoca(node) {
  const pai = node.parent
  if (!pai) return false
  if (pai.type === 'UnaryExpression' && pai.operator === '+' && pai.argument === node) return true
  if (
    pai.type === 'MemberExpression' &&
    pai.object === node &&
    EPOCA.has(nomeDaPropriedade(pai) ?? '') &&
    pai.parent?.type === 'CallExpression' &&
    pai.parent.callee === pai
  ) {
    return true
  }
  return false
}

/** @type {import('eslint').Rule.RuleModule} */
const noClientTimezone = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Proíbe cálculo/formatação de data no cliente (Lei 1): o servidor manda o texto pronto.',
    },
    schema: [],
    messages: {
      relogio:
        '`{{nome}}` em arquivo "use client" resolve no fuso do navegador (Lei 1). Formate no servidor e receba o texto pronto (kit `Instante`). Exceção: comentário `// fuso-ok: <motivo>` na linha acima.',
      locale:
        '`{{nome}}` em arquivo "use client" formata no fuso/locale do navegador (Lei 1). Formate no servidor (Luxon + zona IANA). Exceção: comentário `// fuso-ok: <motivo>` na linha acima.',
      biblioteca:
        'Importar `{{nome}}` em arquivo "use client" traz o cálculo de data para o navegador (Lei 1) — a conversão de fuso mora no servidor. Exceção: comentário `// fuso-ok: <motivo>` na linha acima.',
    },
  },

  create(context) {
    const source = context.sourceCode ?? context.getSourceCode()

    // "use client" só vale como PRIMEIRA diretiva do módulo — é a mesma regra
    // que o Next aplica; um literal solto no meio do arquivo não conta.
    const primeira = source.ast.body[0]
    const ehCliente =
      primeira?.type === 'ExpressionStatement' &&
      primeira.expression?.type === 'Literal' &&
      primeira.expression.value === 'use client'
    if (!ehCliente) return {}

    const comentarios = source.getAllComments()
    if (comentarios.some((c) => JUSTIFICATIVA_ARQUIVO.test(c.value))) return {}
    const justificado = (node) => {
      const linha = node.loc.start.line
      return comentarios.some(
        (c) =>
          JUSTIFICATIVA.test(c.value) &&
          // na linha de cima (ou colada nela, em bloco de várias linhas)
          c.loc.end.line >= linha - 1 &&
          c.loc.start.line <= linha,
      )
    }

    return {
      // `new Date(…)`, `new globalThis.Date(…)`, `new window['Date'](…)`
      NewExpression(node) {
        if (nomeDoObjeto(node.callee) !== 'Date') return
        // aritmética de época não formata nada — e não é violação da Lei 1
        if (soEpoca(node) || justificado(node)) return
        context.report({ node, messageId: 'relogio', data: { nome: 'new Date(…)' } })
      },

      // `Date()` sem `new`: devolve a data COMO TEXTO, no fuso do navegador.
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'Date') return
        if (justificado(node)) return
        context.report({ node, messageId: 'relogio', data: { nome: 'Date()' } })
      },

      MemberExpression(node) {
        const nome = nomeDaPropriedade(node)
        if (!nome) return
        if (PROIBIDOS_LOCALE.has(nome) && !justificado(node)) {
          context.report({ node, messageId: 'locale', data: { nome } })
          return
        }
        if (nome === 'DateTimeFormat' && nomeDoObjeto(node.object) === 'Intl' && !justificado(node)) {
          context.report({ node, messageId: 'locale', data: { nome: 'Intl.DateTimeFormat' } })
        }
      },

      // A biblioteca inteira: `luxon`, `date-fns`, `date-fns-tz`, `date-fns/…`
      ImportDeclaration(node) {
        const fonte = typeof node.source.value === 'string' ? node.source.value : ''
        if (!BIBLIOTECAS.test(fonte) || justificado(node)) return
        context.report({ node, messageId: 'biblioteca', data: { nome: fonte } })
      },
    }
  },
}

/** Plugin local, consumido pelo eslint.config.mjs (flat config). */
export const ptosPlugin = {
  meta: { name: 'ptos', version: '2.0.0' },
  rules: { 'no-client-timezone': noClientTimezone },
}

export default noClientTimezone
