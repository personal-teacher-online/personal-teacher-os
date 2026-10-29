// TRILHO DO PORTAL (Onda do Portal · P1) — o item ACESO e o nome da seção.
//
// Por que isto merece teste de unidade: a barra do portal é a única pista de
// "onde eu estou" que o aluno tem no celular, e a regra que a acende tem dois
// jeitos clássicos de mentir — a raiz `/portal` acendendo em toda tela (prefixo
// em vez de igualdade) e a tela-filha apagando a seção inteira (`/portal/aula/x`
// não começa com `/portal/aulas`). São exatamente os dois casos abaixo.
//
// Vai junto o TOM da ponte `?msg=` → toast, com um varredor que lê NA FONTE os
// seis módulos de ação que alimentam telas com `AvisoLegado` (portal, ficha do
// aluno, admissão, contratos, créditos e agenda): a régua conhece as frases de
// ACERTO e pinta o resto de vermelho, então frase nova de sucesso que ninguém
// listar aparece aqui como teste vermelho — e não como um susto na tela.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  ITEM_MENTORIA,
  ITENS_BASE,
  itemAtivo,
  itensDoPortal,
  tituloDaRota,
  type ItemDoPortal,
} from '@/components/portal/nav'
import { tomDoAviso, type TomDoAviso } from '@/lib/kit/tom-do-aviso'

const de = (href: string): ItemDoPortal =>
  [...ITENS_BASE, ITEM_MENTORIA].find((i) => i.href === href) ?? (() => { throw new Error(`sem item ${href}`) })()

describe('itemAtivo', () => {
  it('a raiz do portal acende SÓ nela mesma', () => {
    const inicio = de('/portal')
    expect(itemAtivo('/portal', inicio)).toBe(true)
    // O erro clássico do prefixo: com `startsWith`, "Início" ficaria aceso em
    // TODA tela do portal, ao lado da seção de verdade.
    expect(itemAtivo('/portal/aulas', inicio)).toBe(false)
    expect(itemAtivo('/portal/perfil', inicio)).toBe(false)
    expect(itemAtivo('/portal/pagamentos', inicio)).toBe(false)
  })

  it('as demais acendem em si e nas filhas', () => {
    const pagamentos = de('/portal/pagamentos')
    expect(itemAtivo('/portal/pagamentos', pagamentos)).toBe(true)
    expect(itemAtivo('/portal/pagamentos/2026-07', pagamentos)).toBe(true)
    expect(itemAtivo('/portal', pagamentos)).toBe(false)
    // prefixo de STRING não basta: `/portal/pagamentosx` é outra rota.
    expect(itemAtivo('/portal/pagamentosx', pagamentos)).toBe(false)
  })

  it('Aulas acende no mundo inteiro das aulas (`tambem`)', () => {
    const aulas = de('/portal/aulas')
    for (const rota of [
      '/portal/aulas',
      '/portal/aula/abc-123',
      '/portal/creditos',
      '/portal/remarcar/abc-123',
      '/portal/cancelar/abc-123',
      // F3: resgatar é a REPOSIÇÃO da aula particular (gasta crédito do
      // makeup_ledger) — mundo de Aulas, nunca da mentoria.
      '/portal/resgatar/ct-1',
    ]) {
      expect(itemAtivo(rota, aulas), rota).toBe(true)
    }
    expect(itemAtivo('/portal/pagamentos', aulas)).toBe(false)
  })

  it('a Mentoria NÃO acende no resgate de reposição; Perfil acende na ciência', () => {
    expect(itemAtivo('/portal/mentoria', ITEM_MENTORIA)).toBe(true)
    expect(itemAtivo('/portal/resgatar/ct-1', ITEM_MENTORIA)).toBe(false)
    expect(itemAtivo('/portal/perfil', de('/portal/perfil'))).toBe(true)
    expect(itemAtivo('/portal/ciencia', de('/portal/perfil'))).toBe(true)
    // …e uma rota nunca acende DUAS seções ao mesmo tempo.
    expect(itensDoPortal(true).filter((i) => itemAtivo('/portal/resgatar/ct-1', i))).toHaveLength(1)
  })
})

describe('itensDoPortal', () => {
  it('sem mentoria: os 4 de todo aluno, com o Perfil no fim', () => {
    expect(itensDoPortal(false).map((i) => i.href)).toEqual([
      '/portal',
      '/portal/aulas',
      '/portal/pagamentos',
      '/portal/perfil',
    ])
  })

  it('Personal Travel: a Mentoria entra ANTES do Perfil', () => {
    expect(itensDoPortal(true).map((i) => i.href)).toEqual([
      '/portal',
      '/portal/aulas',
      '/portal/pagamentos',
      '/portal/mentoria',
      '/portal/perfil',
    ])
    // 5 itens continuam cabendo na barra de polegar (por isso não há "Mais").
    expect(itensDoPortal(true)).toHaveLength(5)
  })
})

describe('título da aba do portal', () => {
  it('/portal termina com o nome da escola (rebrand de 27/10/2026)', () => {
    const fonte = readFileSync(path.resolve(__dirname, '../src/app/portal/page.tsx'), 'utf8')
    expect(fonte).toContain("title: 'Portal — Personal Teacher Academy'")
  })
})

describe('tituloDaRota', () => {
  it('dá o nome do MENU à seção, filhas incluídas', () => {
    expect(tituloDaRota('/portal')).toBe('Início')
    expect(tituloDaRota('/portal/aulas')).toBe('Aulas')
    expect(tituloDaRota('/portal/aula/abc-123')).toBe('Aulas')
    expect(tituloDaRota('/portal/creditos')).toBe('Aulas')
    expect(tituloDaRota('/portal/resgatar/ct-1')).toBe('Aulas')
    expect(tituloDaRota('/portal/pagamentos')).toBe('Pagamentos')
    expect(tituloDaRota('/portal/perfil')).toBe('Perfil')
    expect(tituloDaRota('/portal/ciencia')).toBe('Perfil')
  })

  it('a Mentoria tem nome mesmo para quem não tem a aba', () => {
    expect(tituloDaRota('/portal/mentoria')).toBe('Mentoria')
  })

  it('rota fora do trilho cai no nome da casa', () => {
    expect(tituloDaRota('/portal/briefing')).toBe('Portal do aluno')
  })
})

/* -------------------------------------------------------------------------- */
/* A PONTE ?msg= → toast, cobrada contra a FONTE das ações (P1 · F2)           */
/* -------------------------------------------------------------------------- */

/**
 * Toda string literal de um módulo, com as interpolações reduzidas a `«…»` —
 * e as strings que moram DENTRO de uma interpolação colhidas por si mesmas
 * (`…encodeURIComponent('Briefing enviado! ✅')…` é o caso mais comum aqui).
 *
 * É um varredor de caracteres, não um regex: comentário e string se confundem
 * fácil, e um regex ingênuo colheria as frases dos comentários (que este
 * arquivo tem aos montes) como se fossem recado de tela.
 */
type Quadro = { tipo: 'codigo'; chaves: number; interp: boolean } | { tipo: 'template'; texto: string }

function literaisDe(fonte: string): string[] {
  const achados: string[] = []
  const pilha: Quadro[] = [{ tipo: 'codigo', chaves: 0, interp: false }]
  let i = 0
  while (i < fonte.length) {
    const topo = pilha[pilha.length - 1]!
    const c = fonte[i]!
    if (topo.tipo === 'template') {
      if (c === '\\') {
        topo.texto += fonte.slice(i, i + 2)
        i += 2
        continue
      }
      if (c === '`') {
        achados.push(topo.texto)
        pilha.pop()
        i++
        continue
      }
      if (c === '$' && fonte[i + 1] === '{') {
        topo.texto += '«…»'
        pilha.push({ tipo: 'codigo', chaves: 0, interp: true })
        i += 2
        continue
      }
      topo.texto += c
      i++
      continue
    }
    if (c === '/' && fonte[i + 1] === '/') {
      const fim = fonte.indexOf('\n', i)
      i = fim === -1 ? fonte.length : fim
      continue
    }
    if (c === '/' && fonte[i + 1] === '*') {
      const fim = fonte.indexOf('*/', i)
      i = fim === -1 ? fonte.length : fim + 2
      continue
    }
    if (c === "'" || c === '"') {
      let texto = ''
      let j = i + 1
      while (j < fonte.length && fonte[j] !== c) {
        if (fonte[j] === '\\') {
          texto += fonte[j + 1] ?? ''
          j += 2
          continue
        }
        texto += fonte[j]
        j++
      }
      achados.push(texto)
      i = j + 1
      continue
    }
    if (c === '`') {
      pilha.push({ tipo: 'template', texto: '' })
      i++
      continue
    }
    if (c === '{') {
      topo.chaves++
      i++
      continue
    }
    if (c === '}') {
      if (topo.chaves > 0) topo.chaves--
      else if (topo.interp) pilha.pop()
      i++
      continue
    }
    i++
  }
  return achados
}

/**
 * Das strings do módulo, as que são FRASE DE TELA. Começam com maiúscula OU com
 * uma interpolação (`«…» aula(s) registrada(s)…`, que abre com a contagem) e ou
 * têm três palavras, ou terminam em pontuação de recado — a cauda `«…»` não
 * conta para o fim, senão `Convite reenviado.«…»` ficaria de fora.
 *
 * O CORTE DE DUAS PALAVRAS TERMINADAS EM PONTO entrou ao estender o varredor ao
 * admin (P1 · G4): a régua antiga, de três palavras, deixava escapar oito
 * recados reais e curtos — "Cadastro atualizado.", "Convite reenviado.",
 * "Pagador vinculado.", "Vínculo removido.", "Horário despublicado.", "Aluno
 * inválido.", "Dados incompletos." — e o lote da agenda, que abre com o número.
 *
 * O QUE CONTINUA FORA, e de propósito: `Falha: «…»` e os rótulos de resposta do
 * briefing (`Outro: «…»`) são a MESMA forma — uma palavra, dois-pontos,
 * interpolação —, e não há como separá-los por formato. Entre incluir rótulo que
 * não é recado e deixar de fora o `Falha:` cru, fica de fora o `Falha:`: ele é o
 * prefixo mais óbvio da casa, todas as suas variantes com texto ("Falha ao ler
 * o contrato: «…»", "Falha: informe nome e cidade.") estão cobertas, e o
 * default da régua já é o vermelho que ele quer.
 */
function frasesDeTela(fonte: string): string[] {
  return [
    ...new Set(
      literaisDe(fonte)
        .map((s) => s.trim())
        .filter((s) => {
          if (!/^[A-ZÀ-ÖØ-Þ«]/.test(s)) return false
          const semCauda = s.replace(/(«…»)+$/, '')
          return semCauda.split(/\s+/).length >= 3 || /[.!?✓✔]$/.test(semCauda)
        }),
    ),
  ]
}

/**
 * O QUE AS AÇÕES DO PORTAL DIZEM, e de que cor cada frase tem de sair.
 *
 * A lista é explícita de propósito: quem escrever uma frase nova em
 * `actions.ts` vê este teste quebrar e é obrigado a declarar o tom dela — que é
 * exatamente o momento em que se descobre se ela precisa entrar na lista de
 * sucesso de `tomDoAviso`. Sem isso, a frase nova cai no default (erro) e
 * ninguém percebe até um aluno ver "Reserva confirmada" em vermelho.
 */
const RECADOS_DO_PORTAL: ReadonlyArray<readonly [string, TomDoAviso]> = [
  // ⚠️ A PONTE `?msg=` MORREU NO PORTAL INTEIRO (P4 nas telas de aula, P5 no
  // resto), mas a classificação abaixo NÃO é decoração: TODA frase deste módulo
  // continua passando por `tomDoAviso`. O caminho agora é um só — a action grava
  // a frase no cookie de flash, a MOLDURA do portal a lê e entrega ao mesmo
  // `AvisoLegado`, que decide a cor por esta função. Frase nova sem entrada aqui
  // vira teste vermelho.
  // ---- agendar / remarcar / resgatar ----
  ['Você não tem crédito suficiente para este agendamento.', 'erro'],
  ['Esse horário acabou de ser reservado por outra pessoa — escolha outro.', 'erro'],
  ['Essa aula está perto demais para remarcar — «…».', 'erro'],
  ['Esse horário conflita com outra aula da professora — escolha outro.', 'erro'],
  ['Esse horário está perto demais — escolha um com mais antecedência ou «…».', 'erro'],
  ['Não foi possível concluir: «…»', 'erro'],
  // As TRÊS formas do recado de remarcação (P4 · E1): o preview é consultivo e a
  // via pode trocar entre o render e o clique, então quem conta o desfecho é o
  // banco (`via_da_remarcacao`). Via desconhecida cai na terceira, a de sempre.
  ['Aula remarcada! ✅ (dentro da franquia do mês) Você recebe a confirmação por e-mail.', 'sucesso'],
  ['Aula remarcada! ✅ (usamos 1 crédito de reposição) Você recebe a confirmação por e-mail.', 'sucesso'],
  ['Aula remarcada! ✅ Você recebe a confirmação por e-mail.', 'sucesso'],
  ['Reposição agendada! ✅', 'sucesso'],
  // ---- cancelar / confirmar presença ----
  ['Essa aula já não está mais agendada.', 'erro'],
  ['Essa aula já começou — «…».', 'erro'],
  ['Você não tem acesso a essa aula.', 'erro'],
  ['Não foi possível cancelar: «…»', 'erro'],
  ['Aula cancelada. Você recebe a confirmação por e-mail. ✅', 'sucesso'],
  ['Não deu: «…»', 'erro'],
  ['Presença confirmada — até lá! ✓', 'sucesso'],
  // ---- mentoria ----
  ['Faltam menos de 24h para o encontro — «…» para resolver isso junto.', 'erro'],
  ['Reserva cancelada — seu crédito voltou. ✓', 'sucesso'],
  ['Essa data acabou de lotar — escolha outra.', 'erro'],
  ['Sua próxima mentoria ainda não está liberada.', 'erro'],
  ['Falta definir o critério desta etapa — fale com a gente.', 'erro'],
  ['Não foi possível reservar: «…»', 'erro'],
  ['Mentoria reservada! ✅', 'sucesso'],
  // ---- ciência do canal e perfil ----
  ['O combinado foi atualizado — leia o texto novo antes de continuar.', 'erro'],
  ['Não deu para registrar agora. Tente de novo em instantes.', 'erro'],
  ['Número atualizado. ✓', 'sucesso'],
  // Correção 28/07 — o WhatsApp virou canal de CONTRATO: o banco recusa vazio e
  // é a action que fala português (jargão de banco não chega ao aluno).
  [
    'Escreva o seu número — é por ele que a escola te avisa das aulas. Se você não quiser mais receber por aqui, fale com a gente.',
    'erro',
  ],
  ['Confira o número: escolha o país e digite só o número local, com DDD.', 'erro'],
  ['Não deu para salvar agora. Tente de novo em instantes.', 'erro'],
  ['Falha: a senha ainda precisa de «…».', 'erro'],
  ['Senha trocada. ✓', 'sucesso'],
  // ---- briefing (v1 e v2: a action ANTECIPA o erro que o banco dará) ----
  ['Falha ao abrir seu briefing: «…»', 'erro'],
  // rodada de integração: a tela e a linha discordam de versão do questionário
  ['Falha: a página estava desatualizada — recarregue e tente de novo.', 'erro'],
  ['Falha: escolha pelo menos «…» coisas que você gosta de fazer.', 'erro'],
  ['Falha: marque pelo menos um horário em que você costuma ter tempo.', 'erro'],
  ['Falha: responda as 12 perguntas do teste para continuar.', 'erro'],
  // v2, etapa 1
  ['Falha: marque ao menos uma forma de contato que você já teve com o inglês.', 'erro'],
  // v2, etapa 2 (adulto)
  ['Falha: marque ao menos uma finalidade para praticar inglês.', 'erro'],
  ['Falha: diga qual finalidade é a MAIS importante.', 'erro'],
  ['Falha: “«…»” precisa estar entre as finalidades marcadas acima.', 'erro'],
  ['Falha: marque ao menos um ponto onde você mais trava.', 'erro'],
  ['Falha: diga quanto tempo por dia você tem para estudar.', 'erro'],
  ['Falha: você marcou “«…»” — descreva ao menos «…» tópicos da sua vida profissional.', 'erro'],
  // v2, etapa 2 (criança)
  ['Falha: marque ao menos uma resposta sobre para que o inglês vai servir.', 'erro'],
  // v2, etapa 3
  ['Falha: você respondeu “sim” em “«…»” — conte quais.', 'erro'],
  ['Falha ao salvar: «…»', 'erro'],
  ['Falha: ainda falta uma etapa — complete os campos abaixo.', 'erro'],
  ['Falha: o teste de estilo está incompleto — responda as 12 perguntas.', 'erro'],
  ['Falha ao enviar: «…»', 'erro'],
  ['Briefing enviado! Obrigado. ✅', 'sucesso'],
  // ---- re-briefing semestral (sub-lote 4): as recusas de etapa são as MESMAS
  // do briefing (a action reusa `faltaNaEtapa`), então só entram aqui as três
  // frases próprias. "Não há atualização pendente por aqui." fica no vermelho de
  // propósito: é a corrida de quem enviou em outra aba: o clique não fez o que a
  // pessoa pediu, e o default da régua invertida existe para isso.
  ['Falha ao abrir sua atualização — tente de novo em instantes.', 'erro'],
  ['Não há atualização pendente por aqui.', 'erro'],
  ['Atualização enviada! Sua professora já vai ver. ✅', 'sucesso'],
]

/**
 * O MESMO CONTRATO, AGORA PARA O ADMIN (P1 · G4).
 *
 * As telas do admin que pintam por `AvisoLegado` — hub e ficha do aluno, wizard
 * de admissão, detalhe do contrato — recebem o recado destes cinco módulos, e um
 * deles é a AGENDA: o painel "cancelar" da ficha reusa `cancelClassAction`.
 * Enquanto só o portal era varrido, "Aula cancelada — o aluno GANHOU um crédito
 * de reposição" caía no default e a admin lia em vermelho o cancelamento que deu
 * certo (é o achado G1).
 *
 * Três coisas aparecem nestas listas e não são recado inteiro; ficam marcadas
 * onde estão:
 *   · PEDAÇOS de concatenação (`'…parte um ' + '…parte dois'`) — o varredor vê
 *     cada literal, e o pedaço do meio/fim nunca sai sozinho na tela. O tom
 *     esperado é o do pedaço lido isoladamente;
 *   · frases com cauda `«…»` cujo tom DEPENDE da interpolação (`Aluno «…»
 *     criado, mas…`): aqui vale o tom da forma base, e as instanciações
 *     concretas são cobradas no teste dos parciais (G3);
 *   · o nome do documento mandado ao Autentique, que não é recado de tela.
 */
const RECADOS_DA_FICHA: ReadonlyArray<readonly [string, TomDoAviso]> = [
  // ---- cadastro, lead e ciclo de vida ----
  ['Aluno «…» criado.', 'sucesso'],
  ['Aluno «…» criado, mas a cidade não foi confirmada: «…»', 'erro'], // parcial (G2)
  ['Informe nome e fuso do aluno.', 'erro'],
  ['Lead «…» criado. ✓', 'sucesso'],
  ['Informe o nome do lead.', 'erro'],
  ['Lead marcado como perdido — ele fica arquivado, e a busca continua alcançando. ✓', 'sucesso'],
  ['Lead não informado.', 'erro'],
  ['Cadastro atualizado.', 'sucesso'],
  ['Dados incompletos.', 'erro'],
  ['Fuso atualizado. No relógio novo do aluno as próximas aulas caem em: «…».', 'sucesso'],
  ['Se ficou ruim para ele, troque o horário fixo em Contratos.', 'erro'], // pedaço
  // ---- convite e WhatsApp ----
  // Correção 28/07 (rodada do Sol): o número entrou no PROVISIONAMENTO — ou ele
  // foi gravado, ou o convite nem saiu. Os sufixos de "WhatsApp não salvo"
  // morreram junto com o update best-effort; as falhas agora chegam como
  // `outcome.message` do provisionamento (fora deste varredor, e vermelhas pelo
  // default da régua + marcadores de falha parcial).
  ['Convite enviado! 🎉', 'sucesso'],
  ['Convite enviado! 🎉 WhatsApp no cadastro.', 'sucesso'],
  ['Convite reenviado.', 'sucesso'],
  ['Convite reenviado. WhatsApp atualizado no cadastro.', 'sucesso'],
  ['Este aluno já está com o acesso ativo.', 'sucesso'],
  ['Este aluno já está com o acesso ativo. WhatsApp atualizado no cadastro.', 'sucesso'],
  [
    'Informe o WhatsApp do aluno — é o canal de avisos previsto no contrato. Sem ele, o convite não sai.',
    'erro',
  ],
  // …e o REENVIO deixou de contornar a exigência (achado grave 2 do Sol).
  [
    'Este aluno está sem WhatsApp no cadastro — preencha na ficha antes de reenviar: o convite não sai sem o canal previsto no contrato.',
    'erro',
  ],
  ['Falha ao ler o cadastro: «…»', 'erro'],
  ['Selecione o aluno e informe um e-mail válido.', 'erro'],
  ['Número de WhatsApp inválido — selecione o país e digite só o número local.', 'erro'],
  ['Aluno inválido.', 'erro'],
  ['Este aluno ainda não foi convidado.', 'erro'],
  ['Perfil sem e-mail — fale com o mantenedor.', 'erro'],
  ['WhatsApp do aluno atualizado.', 'sucesso'],
  ['Aluno não encontrado.', 'erro'],
  ['Aluno ainda não tem login — convide primeiro.', 'erro'],
  ['Número inválido — use o formato internacional com "+", ex.: +5565999999999.', 'erro'],
  // ---- nota interna ----
  ['Nota interna salva. ✓', 'sucesso'],
  ['Nota interna apagada.', 'sucesso'],
  ['Falha ao salvar a nota: «…»', 'erro'],
  // ---- pagador ----
  ['Escolha um pagador.', 'erro'],
  ['Pagador vinculado.', 'sucesso'],
  // F3 (Onda Financeiro) — self × terceiro, o vínculo que decide o botão da fatura:
  ['Pagador marcado como o próprio aluno — o botão da fatura liga no portal.', 'sucesso'],
  ['Pagador marcado como terceiro — o portal não mostra a fatura dele.', 'sucesso'],
  ['Informe o nome do pagador.', 'erro'],
  ['Pagador criado e vinculado.', 'sucesso'],
  ['Pagador criado, mas o vínculo falhou: «…»', 'erro'], // parcial
  ['Vínculo removido.', 'sucesso'],
  // ---- anonimização / bloqueio de login ----
  ['Aluno anonimizado: «…»,', 'sucesso'],
  ['«…» registro(s) do WhatsApp expurgado(s)', 'erro'], // pedaço
  ['Não há bloqueio de login pendente neste aluno.', 'erro'],
  ['Falha ao ler a pendência: «…»', 'erro'],
  ['Login bloqueado e credenciais embaralhadas. Anonimização concluída. ✓', 'sucesso'],
  ['Login bloqueado, mas o aviso não foi baixado: «…» — clique de novo.', 'erro'], // parcial
  // ---- briefing e plano (retaguarda) ----
  ['Falha no briefing: «…»', 'erro'],
  ['Briefing preenchido e finalizado em nome do aluno. ✓', 'sucesso'],
  ['Briefing salvo como rascunho (não finalizado). ✓', 'sucesso'],
  ['Falha no lembrete: «…»', 'erro'],
  ['Lembrete de briefing a caminho (e-mail e WhatsApp, se houver número). ✓', 'sucesso'],
  // sub-lote 5: o lembrete do RE-BRIEFING semestral divide a frase de "já
  // mandei hoje" com o de cima (mesma dedupe diária, mesmo recado)
  ['Lembrete de atualização a caminho (e-mail e WhatsApp, se houver número). ✓', 'sucesso'],
  ['Lembrete de hoje já tinha sido enviado — amanhã pode de novo.', 'sucesso'],
  ['Falha ao gerar o plano: «…»', 'erro'],
  ['Plano do semestre gerado — a professora personaliza no painel dela. ✓', 'sucesso'],
  // ---- correção pós-envio do briefing (v2) ----
  ['Correção sem etapa — abra pelo botão “Corrigir resposta”.', 'erro'],
  ['Falha na correção: «…»', 'erro'],
  ['Este aluno ainda não tem briefing para corrigir.', 'erro'],
  ['Correção registrada — ela fica no histórico do briefing, com o de/para. ✓', 'sucesso'],
]

const RECADOS_DA_ADMISSAO: ReadonlyArray<readonly [string, TomDoAviso]> = [
  ['Falha: informe nome e cidade.', 'erro'],
  ['Aluno «…» criado. ✓', 'sucesso'],
  ['Aluno «…» criado, mas a cidade não foi confirmada: «…»', 'erro'], // parcial (G2)
  ['«…» (os campos não voltaram preenchidos: o que você digitou não cabe no endereço)', 'erro'], // pedaço
  ['Falha: preencha professora, plano, valor (0 = cortesia) e início.', 'erro'],
  ['Falha: o nome do plano cabe em «…» caracteres.', 'erro'],
  ['Contrato criado (sem horário fixo ainda — dá para criar na tela do contrato). ✓', 'sucesso'],
  ['Contrato e «…» horário«…» criados. ✓', 'sucesso'],
]

const RECADOS_DOS_CONTRATOS: ReadonlyArray<readonly [string, TomDoAviso]> = [
  ['Falha: o nome do plano cabe em «…» caracteres.', 'erro'],
  ['Regras atualizadas (valem para os próximos atos).', 'sucesso'],
  // Onda Financeiro · F2 — o painel da mensalidade (previsto v3):
  ['Falha: informe a mensalidade em reais (ex.: 599,00) — ou deixe vazio para despublicar.', 'erro'],
  ['Mensalidade despublicada — o previsto deste contrato volta a 0.', 'sucesso'],
  ['Mensalidade salva.', 'sucesso'],
  ['Contrato encerrado — «…» aula(s) futura(s) cancelada(s),', 'sucesso'],
  ['«…» crédito(s) transferido(s), «…» baixado(s).', 'erro'], // pedaço
  ['Falha: informe o valor da aula — cortesia é 0 explícito, não campo em branco.', 'erro'],
  ['Contrato renovado — horários emendados na virada e créditos transferidos. ✓', 'sucesso'],
  ['Slot criado e aulas materializadas.', 'sucesso'],
  [
    'Horário alterado: slot antigo fechado, aulas futuras dele canceladas (sem crédito) e novo horário materializado.',
    'sucesso',
  ],
  ['Crédito ajustado («…»«…»). Saldo novo: «…».', 'sucesso'],
  ['Contrato pausado — novas aulas deixam de ser criadas e as já agendadas ficam', 'sucesso'],
  ['Contrato reativado — «…» crédito(s) com validade estendida', 'sucesso'],
  // ---- assinatura (Autentique) ----
  ['Informe o contrato e um e-mail válido.', 'erro'],
  ['O segundo e-mail de signatário é inválido.', 'erro'],
  ['Anexe o PDF do contrato.', 'erro'],
  ['PDF grande demais (limite 8MB).', 'erro'],
  ['AUTENTIQUE_TOKEN ausente — configure no deploy (runbook §N).', 'erro'],
  ['Falha ao ler o contrato: «…»', 'erro'],
  ['Contrato não encontrado.', 'erro'],
  ['Contrato Personal Teacher Academy — «…»', 'erro'], // nome do documento, não é recado
  ['Não deu para saber o que aconteceu no Autentique: «…».', 'erro'],
  ['A reserva deste contrato ficou ABERTA de propósito — o documento pode ter sido criado.', 'erro'], // pedaço
  [
    'Abra o painel do Autentique: se o documento existir, anexe o id dele à reserva; se não existir, cancele a reserva. As duas coisas estão na seção Assinatura deste contrato.',
    'erro',
  ], // pedaço
  ['O Autentique recusou o envio (nenhum documento foi criado): «…»', 'erro'],
  ['Documento criado no Autentique («…») mas o espelho local não anexou o id: «…».', 'erro'],
  [
    'A reserva deste contrato continua aberta — copie esse id e use “Anexar id do documento” na seção Assinatura.',
    'erro',
  ], // pedaço
  ['Contrato enviado para assinatura ✔ («…»«…»)«…»', 'sucesso'],
  ['Falha: cole o id do documento que está no Autentique.', 'erro'],
  ['Documento anexado à reserva ✔ — o estado agora acompanha o Autentique.', 'sucesso'],
  ['Reserva cancelada — o contrato pode ser enviado de novo quando você quiser.', 'sucesso'],
  ['Documento não informado.', 'erro'],
  ['Não consegui consultar o Autentique: «…»', 'erro'],
  ['Ainda sem movimento nesta assinatura (nem visualizada).', 'sucesso'],
  ['Falha ao aplicar: «…»', 'erro'],
  ['Este documento não está espelhado localmente.', 'erro'],
  ['Status atualizado: «…».', 'sucesso'],
]

const RECADOS_DO_CREDITO: ReadonlyArray<readonly [string, TomDoAviso]> = [
  ['Validade estendida — o crédito continua com a mesma duração e origem. ✓', 'sucesso'],
]

const RECADOS_DA_AGENDA: ReadonlyArray<readonly [string, TomDoAviso]> = [
  // ---- desfechos (o painel "cancelar" da FICHA usa `cancelClassAction`) ----
  [
    'Falha: diga o que foi trabalhado — escolha um tema na lista (ou a professora aponta o módulo do plano no painel dela).',
    'erro',
  ],
  // A5/L5: `DateTime.fromISO('…T13:00Z', { zone })` é VÁLIDO e vale 13:00Z — a
  // recusa agora é de FORMATO (hora civil pura), e a frase ensina o gesto.
  [
    'Falha: data/hora do aviso inválida — use o seletor do campo, que vale no horário de Cuiabá; hora com fuso escrito à mão (Z, +00:00) não é aceita. Nada foi cancelado.',
    'erro',
  ],
  ['Aula cancelada — o aluno GANHOU um crédito de reposição (vale até «…»).', 'sucesso'], // G1
  // ---- A5/L3 · a matriz do ADR-018 (`registrarDesfechoDaAulaAction`) --------
  // As frases de consequência foram MEDIDAS no corpo efetivo das RPCs (a tabela
  // está no cabeçalho de `src/lib/admin/desfecho-da-aula.ts`). O que este
  // varredor cobra aqui é a COR de cada uma, e há três pares que só ele separa:
  //   · "GANHOU um crédito" é acerto (verde) e sai por prefixo enumerado;
  //   · "— mas o crédito … NÃO foi devolvido automaticamente" é sucesso PARCIAL
  //     em dinheiro e tem de sair VERMELHO, senão a dona vê o ✓ da casa em cima
  //     de um crédito que nunca entrou no ledger;
  //   · "— mas a trilha não registrou crédito" é o ramo defensivo do mesmo par.
  // Cada uma é UMA frase inteira no módulo, nunca pedaço somado a outro — é a
  // frase completa que `tomDoAviso` classifica.
  // O PEDAÇO compartilhado das três frases de cancelamento (a constante
  // `ENTREGA_DO_AVISO`): o varredor vê cada literal, e este nunca sai sozinho na
  // tela. Lido isolado, ele não é acerto enumerado — e é isso que a lista declara.
  [
    'O aviso do cancelamento fica REGISTRADO para envio: e-mail sempre, e WhatsApp quando há número no cadastro dele. Se ele saiu, você confere em Mensagens.',
    'erro',
  ],
  // A6/lote 2 — OS OUTROS TRÊS RAMOS DA MESMA FRASE. Desde a migration 99 a
  // dona escolhe os canais na confirmação, e o pedaço acima ("e-mail sempre")
  // só é verdade quando ela marca os dois. Cada combinação tem a sua frase
  // INTEIRA, pelas mesmas duas razões dos recados de crédito: `tomDoAviso`
  // classifica a frase completa, e o varredor lê literal por literal. Nenhum
  // dos três sai sozinho na tela.
  [
    'O aviso do cancelamento fica REGISTRADO para envio por e-mail; você escolheu não avisar por WhatsApp. Se ele saiu, você confere em Mensagens.',
    'erro',
  ],
  [
    'O aviso do cancelamento fica REGISTRADO para envio por WhatsApp, quando há número no cadastro dele; você escolheu não avisar por e-mail. Se ele saiu, você confere em Mensagens.',
    'erro',
  ],
  // O ramo em que ela desmarcou os DOIS: o ato deu certo (a frase que o carrega
  // continua VERDE por prefixo), mas este pedaço não pode ficar mudo — a aula
  // sumiu da agenda de alguém que não foi avisado.
  [
    'Nenhum aviso do cancelamento ficou registrado: você escolheu não avisar o aluno. Ele descobre a aula cancelada sozinho, na agenda dele — combine a conversa.',
    'erro',
  ],
  // …e o alerta do estorno bloqueado tem o mesmo par: "o aviso já saiu dizendo
  // que não houve crédito" seria FALSO quando nenhum aviso saiu. A ATRIBUIÇÃO
  // saiu da frase no lote final (revisão independente do A6, menor 2): "você
  // escolheu não avisar" é falso quando as caixas nasceram desmarcadas por
  // falta de destinatário — ali quem escolheu foi a tela.
  [
    'Atenção: nenhum aviso foi registrado para o aluno — o crédito e o cancelamento chegam por você.',
    'erro',
  ],
  // ══════════════════════════════════════════════════════════════════════════
  // A6 · rodada 2 do Sol — MARCAR A CAIXA NÃO É AVISAR
  // ══════════════════════════════════════════════════════════════════════════
  // As quatro frases acima liam só a ESCOLHA da dona. A caixa não é
  // desabilitada (régua da casa), então marcar um canal sem destinatário é
  // gesto possível — e o que ele produz, medido em `_enqueue_class_cancelled`,
  // é diferente por canal: e-mail sem login nasce ÓRFÃO (linha presa em
  // Mensagens) e WhatsApp sem número NEM NASCE. Cada combinação é UMA frase
  // inteira, e nenhuma delas sai sozinha na tela.
  //
  // TOM, RECONTADO NO LOTE FINAL (revisão independente do A6, M1): a contagem
  // "os três ramos em que ela marcou e nada chega saem VERMELHOS" estava
  // errada — os dois ramos em que ela marcou um canal e NADA chegou ao aluno
  // (`ENTREGA_EMAIL_ORFAO_SO` e `ENTREGA_SO_WHATSAPP_SEM_NUMERO`) não tinham
  // marcador nenhum, e a frase COMPOSTA saía verde, com o ✓ da casa. Isolados,
  // eles já caíam no vermelho pelo default da régua — que é exatamente por que
  // este varredor não pegava o defeito: quem decide a cor é a frase que chega
  // à tela, e ela é a composta. A cor da COMPOSIÇÃO é cobrada em
  // `tests/onda-agenda-lote-final.test.ts`, montada como a action monta.
  [
    'O aviso do cancelamento fica REGISTRADO para envio por e-mail — mas o WhatsApp você marcou e não há número no cadastro dele, então nada foi registrado por lá. Se o e-mail saiu, você confere em Mensagens.',
    'erro',
  ],
  // e-mail entregue, WhatsApp desligado porque não HÁ número: a caixa nasceu
  // assim, então a frase conta o fato em vez de atribuir uma escolha a ela.
  [
    'O aviso do cancelamento fica REGISTRADO para envio por e-mail. Por WhatsApp não há número no cadastro dele, então não havia o que registrar por lá. Se o e-mail saiu, você confere em Mensagens.',
    'erro',
  ],
  [
    'Nada chega ao aluno por aqui — mas o cancelamento está registrado: o e-mail que você marcou ficou SEM destinatário, porque este aluno não tem acesso ao portal (a linha só espera conferência em Mensagens), e sem perfil não há número para o WhatsApp. Combine a conversa com ele.',
    'erro',
  ],
  [
    'Nada chega ao aluno por aqui — mas o cancelamento está registrado: sem acesso ao portal o e-mail fica sem destinatário (a linha só espera conferência em Mensagens), e sem número no cadastro o aviso por WhatsApp nem é registrado. Combine a conversa com ele.',
    'erro',
  ],
  [
    'O aviso por WhatsApp não foi registrado — não há número no cadastro dele —, e por e-mail você escolheu não avisar: nada chega ao aluno por aqui, embora o cancelamento esteja registrado. Ele descobre a aula cancelada sozinho, na agenda dele — combine a conversa.',
    'erro',
  ],
  [
    'O aviso por WhatsApp não foi registrado — este aluno não tem acesso ao portal, e sem perfil não há número no cadastro. Por e-mail também não havia destinatário. O cancelamento está registrado, mas nada chega até ele: o recado vai por você.',
    'erro',
  ],
  // "na agenda dele" só existe para quem TEM agenda (menor 1): o ramo de quem
  // não tem portal ganhou variante própria, e ela não manda ninguém olhar uma
  // tela a que ele não tem acesso.
  [
    'Nenhum aviso do cancelamento ficou registrado: por e-mail você escolheu não avisar, e não há número no cadastro dele para o WhatsApp. Ele descobre a aula cancelada sozinho, na agenda dele — combine a conversa.',
    'erro',
  ],
  [
    'Nenhum aviso do cancelamento ficou registrado: este aluno não tem acesso ao portal e não há número no cadastro dele, então não havia por onde avisar. Ele não vê a aula sair da agenda — o recado chega por você.',
    'erro',
  ],
  // …e o terceiro estado do alerta do estorno bloqueado: ela marcou, e o canal
  // não tem para onde ir. Nem "você escolheu não avisar" (troca a decisão dela)
  // nem "o aviso já saiu" (afirma um envio que não existe).
  [
    'Atenção: o aviso que você marcou não tem como chegar a este aluno (sem acesso ao portal e/ou sem número no cadastro) — o crédito e o cancelamento chegam por você.',
    'erro',
  ],
  // Os outros dois PEDAÇOS das frases de estorno bloqueado (revisão independente
  // do A5, grave 1): o destino CERTO do ajuste manual — a ficha do aluno é
  // somente-leitura, quem lança é o "Ajustar" do contrato — e o alerta de que o
  // aviso já saiu dizendo "sem crédito". Nenhum dos dois sai sozinho na tela.
  [
    'Para devolver o crédito, vá em Contratos, abra o contrato do aluno e use "Ajustar" no bloco de Créditos (o motivo é obrigatório e fica auditado).',
    'erro',
  ],
  [
    'Atenção: o aviso que saiu para o aluno diz que NÃO houve crédito — depois de ajustar, fale com ele.',
    'erro',
  ],
  // As duas recusas de DST do campo "quando o aviso chegou" (Lei 1): a hora civil
  // que não existe, e a que acontece duas vezes.
  [
    'Falha: nesse dia o horário de verão COMEÇA em «…» e o relógio de lá pula essa hora — o aviso não pode ter chegado nesse minuto. Informe um minuto vizinho, ou deixe o campo em branco para registrar "agora". Nada foi cancelado.',
    'erro',
  ],
  [
    'Falha: em «…» essa hora acontece DUAS vezes nesse dia (o horário de verão termina) e não dá para saber qual delas você quis. Informe um minuto vizinho, ou deixe o campo em branco para registrar "agora". Nada foi cancelado.',
    'erro',
  ],
  ['Falha: aula não identificada — recarregue a agenda e tente de novo.', 'erro'],
  [
    'Falha: escolha o que aconteceu com esta aula — cada opção tem consequência diferente no extrato da professora e no crédito do aluno.',
    'erro',
  ],
  [
    'Aula registrada como realizada. ✓ A hora conta no extrato da professora, e o aluno não ganha crédito.',
    'sucesso',
  ],
  [
    'Falta do aluno registrada — a aula conta como dada: a hora conta no extrato da professora, e o aluno não ganha crédito.',
    'sucesso',
  ],
  [
    'Falta da professora registrada — o aluno GANHOU um crédito de reposição (vale até «…»). A hora não conta no extrato da professora.',
    'sucesso',
  ],
  [
    'Falta da professora registrada — mas o crédito de reposição NÃO foi devolvido automaticamente: «…». «…» A hora não conta no extrato da professora.',
    'erro',
  ],
  [
    'Falta da professora registrada — mas a trilha não registrou crédito de reposição para o aluno. Confira o saldo dele na ficha antes de avisar.',
    'erro',
  ],
  [
    'Falta da professora registrada, mas não deu para ler se o crédito foi gerado — confira o extrato de créditos do aluno na ficha dele.',
    'erro',
  ],
  [
    'Aula cancelada a pedido do aluno — sem crédito de reposição: quem decide é quem pediu o cancelamento, em qualquer antecedência (para trocar de horário sem perder a aula, o caminho é remarcar). A hora não conta no extrato da professora. «…»',
    'sucesso',
  ],
  [
    'Aula cancelada a pedido da professora — o aluno GANHOU um crédito de reposição (vale até «…»). A hora não conta no extrato da professora. «…»',
    'sucesso',
  ],
  [
    'Aula cancelada a pedido da professora — mas o crédito de reposição NÃO foi devolvido automaticamente: «…». «…» «…»',
    'erro',
  ],
  [
    'Aula cancelada a pedido da professora — mas a trilha não registrou crédito de reposição para o aluno. Confira o saldo dele na ficha antes de avisar.',
    'erro',
  ],
  // As recusas traduzidas das três RPCs (cada `raise` foi lido no corpo efetivo).
  [
    'Falha: esta aula já começou, e cancelar exige um aviso ANTERIOR ao início. Se o aviso chegou antes, informe a hora dele no campo. Se ninguém apareceu, espere a aula terminar: aí a matriz oferece falta do aluno e falta da professora. Nada foi cancelado.',
    'erro',
  ],
  [
    'Falha: a hora do aviso está no futuro — informe quando o aviso realmente chegou. Nada foi cancelado.',
    'erro',
  ],
  // A guarda do BANCO é "ainda não começou"; a régua da TELA espera o FIM (regra
  // da casa — o corte no fim é o achado 3 do A3). A frase diz as duas sem trocar
  // a autoria de uma pela da outra (Sol · rodada 1 do A5, grave).
  [
    'Falha: esta aula ainda não começou — realizada e falta são retrospectivas, e nesta tela elas aparecem só depois que a aula TERMINA (regra da casa, para ninguém atestar aula em andamento). Até lá, o que dá para fazer é cancelar.',
    'erro',
  ],
  [
    'Falha: esta aula já tem desfecho registrado — recarregue a agenda para ver o estado atual dela.',
    'erro',
  ],
  [
    'Falha: o estorno do crédito desta aula não pôde ser calculado — confira o extrato de créditos do aluno na ficha dele. Nada foi registrado.',
    'erro',
  ],
  // A5/L5: as duas RPCs exigem `contract_type = 'private_1on1'`, e esse `raise`
  // não tinha tradução — caía no texto cru, com nome de coluna na frente da dona
  // numa recusa que ela pode encostar de verdade (a mesma grade mostra mentoria).
  [
    'Falha: esta matriz registra desfecho só de aula particular 1:1. Sessão de mentoria em grupo se trata na tela de Mentoria, que tem as regras de vaga e de crédito dela. Nada foi alterado nesta aula.',
    'erro',
  ],
  // O texto cru do banco, com o fecho que diz que nada aconteceu no caminho do
  // cancelamento (o `Falha: «…»` sem cauda continua fora do varredor por forma).
  ['Falha: «…» Nada foi cancelado.', 'erro'],
  // Onda da Agenda · A1, correções da rodada 1 do Sol. As três são VERMELHAS —
  // e a do meio é a que mais importa: "Aula remarcada" é prefixo de SUCESSO
  // enumerado, e sem o marcador `, mas ` ela sairia com o ✓ da casa em cima de
  // um aviso que não foi enviado ao aluno.
  // A5/L5 (rodada 2): registrar não é enviar, e enviar não é entregar. As duas
  // frases da remarcação passaram a prometer o REGISTRO, e a remissão virou AVISOS
  // (o nome da TELA; "Mensagens" é o rótulo do menu).
  [
    'Aula remarcada — mas o aviso ao aluno NÃO foi registrado para envio. Avise por WhatsApp e confira em Mensagens.',
    'erro',
  ],
  [
    'Falha: escolha a professora antes de registrar em lote — o atestado em massa entra no extrato dela e é sempre por professora.',
    'erro',
  ],
  // ---- F5 (Onda Financeiro): cobrar a aula avulsa no Asaas ----
  // As frases de DESFECHO da emissão (sucesso/adoção/recusas do banco) moram
  // no núcleo `src/lib/asaas/emissao.ts` — fora desta varredura, mas dentro de
  // `tomDoAviso` (prefixos em FRASES_DE_SUCESSO; falha abre com "Falha:").
  ['Falha: aula inválida.', 'erro'],
  ['Falha: informe o vencimento da cobrança (uma data válida).', 'erro'],
  ['Falha: o vencimento não pode ficar no passado.', 'erro'],
  [
    'Falha: a integração com o Asaas está desligada neste ambiente — emita pelo painel do Asaas com o UUID da aula (rotina P21), ou ligue ASAAS_API_KEY/ASAAS_ENV.',
    'erro',
  ],
  // Rodada 3 do Sol: o lote viaja com os IDs exatos da fila; chegar sem nenhum
  // é envio de aba velha/forjado — recusa antes de tocar a RPC.
  [
    'Falha: o lote chegou sem nenhuma aula — recarregue as pendências e confirme de novo.',
    'erro',
  ],
  // Rodada 2 do Sol (item 3): a frase deixou de AFIRMAR "ficou publicado" —
  // o cancelamento também falha quando outro aluno consumiu a janela, e aí o
  // horário NÃO está mais aberto. O recado diz o que se sabe e manda conferir.
  // (Rodada 3: data+hora viraram UM trecho humanizado — por isso um «…» só.)
  [
    'Falha: «…» ATENÇÃO: não deu para confirmar o desfazimento do horário «…» — confira na grade se ele está aberto e despublique se for o caso.',
    'erro',
  ],
  // Onda da Agenda · A1: a leitura da auditoria deixou de ter o `error`
  // descartado. Começa com "Aula cancelada" (prefixo de SUCESSO enumerado), mas
  // o marcador `, mas ` tem a palavra final — é falha parcial, e é vermelha.
  [
    'Aula cancelada, mas não deu para ler se gerou crédito — confira o saldo do aluno na ficha dele.',
    'erro',
  ],
  // A5: a frase deste ramo era FALSA — o “prazo mínimo” descreve uma regra
  // que `_cancel_class_core` não tem (quem decide crédito é `p_cancelled_by`,
  // ADR-018). Continua VERDE porque o ato concluiu como pedido; o que mudou é
  // ela dizer a verdade sobre o dinheiro. (A action segue servindo a FICHA.)
  [
    'Aula cancelada — sem crédito de reposição. Quem decide o crédito é quem pediu o cancelamento, não a antecedência do aviso: pedido do aluno nunca credita. Se foi a professora, confira o extrato de créditos do aluno na ficha dele.',
    'sucesso',
  ],
  // ---- janelas ----
  ['Falha: preencha professora, data e hora.', 'erro'],
  ['Horário publicado — os alunos da professora já podem remarcar para ele.', 'sucesso'],
  ['Horário despublicado.', 'sucesso'],
  // A4/rodada 2 do Sol — os dois porteiros novos das actions de criação.
  // GRAVE 4: publicar janela NOVA dentro de um bloqueio da professora era
  // permitido (a rodada 1 só tinha consertado a FRASE sobre janela já
  // publicada). Fail-closed: leitura que falha também recusa.
  [
    // A NOTA DO BLOQUEIO SAIU DA FRASE (revisão independente do A4, grave 2):
    // ela ia para a query string, e é onde se escreve "consulta médica da
    // dona". Agora o bloqueio é nomeado pelo PERÍODO (`resumoDoBloqueio`, a
    // mesma grafia do painel) e o fecho da frase diz o que NÃO aconteceu —
    // publicado / criado / remarcado, porque o mesmo porteiro cobre as quatro
    // portas (bloqueador 1: as duas criações de aula entraram).
    'Falha: esse horário está dentro de um bloqueio da professora«…» — ela não atende no período. O motivo do bloqueio está em "Disponibilidade e bloqueios"; remova-o lá se ela for atender mesmo assim. Nada foi «…».',
    'erro',
  ],
  ['Falha ao conferir os bloqueios da professora: «…» — nada foi «…».', 'erro'],
  // GRAVE 1 da revisão independente: `Number(x) || 45` transformava 0 (e o
  // campo em branco) numa aula de 45 minutos, que depois conta 45 minutos no
  // extrato da professora.
  [
    'Falha: a duração da aula precisa ser um número inteiro de minutos entre «…» e «…» — campo em branco e zero não viram 45 minutos em silêncio, porque a duração é hora paga no extrato da professora. Nada foi criado.',
    'erro',
  ],
  // GRAVE 1 (DST): a hora civil que não existe — ou que existe DUAS vezes — no
  // relógio do aluno era gravada assim mesmo, no instante errado. A frase
  // detalhada vem de `src/lib/admin/hora-civil.ts`; o que a action escreve é o
  // "Falha: «…»" de sempre. O que precisa de entrada aqui é a recusa da
  // LEITURA do fuso do contrato, que é fail-closed.
  ['Falha ao conferir o fuso do contrato: «…» — nada foi criado.', 'erro'],
  // A6/a: a conversão civil→instante passou a ser ETAPA do ato (a RPC recebe
  // `p_starts_at_utc`), então "não sei o fuso deste contrato" deixou de ser um
  // caso em que se seguia e a RPC recusava — ela precisa recusar AQUI, porque
  // sem zona não há instante para mandar.
  [
    'Falha: não deu para saber em que fuso esta aula acontece — confira se o contrato é particular, está ativo e tem aluno com cidade cadastrada. Nada foi criado.',
    'erro',
  ],
  // ---- A3: disponibilidade e bloqueios da professora ----
  ['Falha: preencha professora, dia da semana e os horários de início e fim.', 'erro'],
  ['Falha: o fim da janela precisa ser depois do início.', 'erro'],
  // Rodada de correção do A3 (item 13): weekday é inteiro 0–6 no SERVIDOR —
  // `Number(' ')` vale 0 e um envio forjado viraria "domingo" em silêncio.
  ['Falha: dia da semana inválido — escolha um dia da lista.', 'erro'],
  ['Janela semanal criada — a grade e os horários ofertáveis já a consideram. ✓', 'sucesso'],
  ['Falha: a janela a remover não foi identificada — recarregue a página.', 'erro'],
  ['Janela semanal removida.', 'sucesso'],
  ['Falha: preencha professora e o período (de/até) do bloqueio.', 'erro'],
  ['Falha: o período está invertido — a data final vem antes da inicial.', 'erro'],
  // Rodada de correção do A3 (item 5 — grave): a RPC da F5 não confere `kind`
  // e apagava exceção `open` com a frase verde; a action agora lê antes, e a
  // leitura que falha recusa (fail-closed) em vez de seguir às cegas.
  ['Esse registro não é um bloqueio — nada foi removido.', 'erro'],
  ['Falha ao conferir o bloqueio: «…» — nada foi removido.', 'erro'],
  // A6/f: a frase mudou porque o COMPORTAMENTO mudou — o bloqueio cancela as
  // janelas publicadas do período, então ela parou de ensinar o gesto manual de
  // despublicar (que era verdade até a migration 97).
  [
    'Bloqueio criado — a professora para de receber horários NOVOS no período, e os horários de remarcação já publicados nele saíram da oferta. Aulas já marcadas continuam de pé: trate-as em Período ou férias.',
    'sucesso',
  ],
  ['Falha: o bloqueio a remover não foi identificado — recarregue a página.', 'erro'],
  ['Bloqueio removido — a oferta do período voltou ao normal.', 'sucesso'],
  // ---- remarcação a partir da grade (`friendlyBookError`) ----
  ['O aluno não tem crédito suficiente para esta remarcação.', 'erro'],
  ['Esse horário acabou de ser tomado — escolha outro.', 'erro'],
  ['A aula está perto demais do início para remarcar pelo sistema.', 'erro'],
  ['Esse horário conflita com outra aula da professora.', 'erro'],
  [
    'Esse horário está dentro da antecedência mínima da professora — use o "furar antecedência" se for combinado.',
    'erro',
  ],
  ['O novo horário precisa estar dentro das próximas 2 semanas.', 'erro'],
  ['Não foi possível concluir: «…»', 'erro'],
  [
    'Aula remarcada. A confirmação para o aluno fica registrada para envio por e-mail (e WhatsApp, quando há número no cadastro dele); se ela saiu, você confere em Mensagens.',
    'sucesso',
  ],
  // A4/rodada 2 (grave 6): com o motivo da cortesia fora da URL, ele passou a
  // ter vida curta (cookie de 60s). A recusa abaixo ANTECIPA o
  // `raise 'cortesia exige motivo (M1-6)'` de `reschedule_class_at` — a
  // invariante continua sendo do banco; o que muda é a dona entender o porquê.
  [
    'Falha: a cortesia exige o motivo — escreva-o em "Opções da administração" e aplique de novo. Nada foi remarcado.',
    'erro',
  ],
  // O "Aplicar" das opções virou Server Action (grave 6) e recusa id de aula
  // que não serve para montar caminho.
  ['Falha: aula não identificada — abra a remarcação de novo pela agenda.', 'erro'],
  // ---- lote, avulsa, experimental, período ----
  ['«…» aula«…» registrada«…» como realizada«…». ✓', 'sucesso'],
  // Portão de deploy 29/07 (bloqueador 1): o lote diz o desfecho REAL. Quando
  // o número feito é menor que o pedido — alguém apagou o apontamento entre o
  // render e o submit —, a frase conta as duas metades, e o "— mas" a manda
  // para o vermelho. Verde só quando o prometido é o feito.
  [
    '«…» aula«…» registrada«…» como realizada«…» — mas «…» continua«…» sem registro, por estar sem apontamento do que foi trabalhado. Registre o apontamento e confirme de novo.',
    'erro',
  ],
  ['Aula avulsa criada — ela entra sozinha nos lembretes e no extrato. ✓', 'sucesso'],
  ['Aula experimental criada (com contrato experimental leve). ✓', 'sucesso'],
  // A5/L5 (rodada 2, grave): a frase afirmava crédito E aviso para TODAS as
  // canceladas, e a RPC devolvia só as contagens — a aula nascida de crédito
  // antigo sem identidade não é recreditada, e aviso é registro, não entrega.
  //
  // A6/lote 2: a dívida foi PAGA no banco (`admin_period_treatment` devolve
  // `credited` e `refund_blocked`), e a frase única virou DUAS — porque o
  // desfecho é de duas naturezas diferentes:
  //   · todas creditaram → acerto limpo, VERDE, com a contagem do crédito dita;
  //   · alguma voltou sem crédito → sucesso PARCIAL em dinheiro, e sucesso
  //     parcial é VERMELHO (o `— mas ` tem a palavra final). Sem isso, a dona
  //     veria o ✓ da casa em cima de um aluno que ficou sem o crédito dele.
  [
    'Período tratado: oferta bloqueada, «…» aula(s) cancelada(s) — «…» com crédito de reposição para o aluno — e «…» convite(s) de remarcação. Os avisos ficam registrados para envio; se saíram, você confere em Mensagens.',
    'sucesso',
  ],
  [
    'Período tratado: oferta bloqueada, «…» aula(s) cancelada(s) e «…» convite(s) de remarcação — mas «…» dela(s) NÃO gerou crédito de reposição (aula que já tinha nascido de um crédito antigo sem identidade); «…» gerou(aram). Veja quais no histórico de cada aluno e ajuste o crédito em Contratos, no bloco de Créditos. Os avisos ficam registrados para envio; se saíram, você confere em Mensagens.',
    'erro',
  ],
  ['Falha: preencha data e hora do novo horário.', 'erro'],
]

/**
 * O QUE A TELA DE AJUSTES DIZ (Onda da Agenda · A8).
 *
 * Módulo novo entra no varredor no MESMO commit em que nasce: a tela é nova,
 * mas a ação dela usa a ponte `?msg=` da seção, e uma frase de acerto fora da
 * lista de `tomDoAviso` sai vermelha.
 */
const RECADOS_DOS_AJUSTES: ReadonlyArray<readonly [string, TomDoAviso]> = [
  ['Falha: professora não identificada — recarregue a página.', 'erro'],
  ['Falha: informe a antecedência mínima em horas.', 'erro'],
  ['Falha: a antecedência mínima é um número inteiro de horas.', 'erro'],
  ['Falha: escolha o que fazer com as aulas em feriado.', 'erro'],
  ['Política da professora atualizada.', 'sucesso'],
]

/**
 * O QUE A TELA DA PAUTA DIZ (frente de conteúdo · M4).
 *
 * As duas últimas de acerto trazem travessão + consequência, e é aí que mora a
 * armadilha: o marcador de falha parcial dispara pelo "mas", não pelo traço.
 * Elas passam — e este teste é o que garante que continuem passando se alguém
 * reescrever a frase.
 */
const RECADOS_DA_PAUTA: ReadonlyArray<readonly [string, TomDoAviso]> = [
  ['Falha: escolha uma das plataformas da lista.', 'erro'],
  ['Falha: escreva só o @ do perfil, sem link e sem espaços.', 'erro'],
  ['Falha: escreva o nome do criador.', 'erro'],
  ['Falha: escolha se o criador é do Brasil ou internacional.', 'erro'],
  // Leva 1 (tier/tipo): recusas com travessão + consequência, como as de
  // acerto abaixo — o marcador de falha parcial não dispara pelo traço.
  ['Falha: o tipo é criador ou empresa — escolha um dos dois.', 'erro'],
  ['Falha: o tier é grande, média ou nicho — ou fica sem classificação.', 'erro'],
  ['Falha: criador não identificado — recarregue a página.', 'erro'],
  ['Criador adicionado à pauta.', 'sucesso'],
  ['Criador atualizado.', 'sucesso'],
  ['Criador desativado — o robô de pesquisa deixa de olhar para ele.', 'sucesso'],
  ['Criador reativado — volta para a próxima corrida da pesquisa.', 'sucesso'],
]

/**
 * O QUE A TELA DO RADAR DIZ (Estúdio v2 · Levas 3 e 4).
 *
 * Módulo novo entra no varredor no MESMO commit em que nasce (regra da casa).
 * As frases de RECUSA DO BANCO não estão aqui de propósito: moram na gramática
 * (`radar-gramatica.ts`), fora do alcance do varredor, e todas abrem com
 * "Falha:" — tom certo pelo default. As duas primeiras falhas são
 * compartilhadas entre descartar e ajustar nota (o varredor deduplica por Set).
 */
const RECADOS_DO_RADAR: ReadonlyArray<readonly [string, TomDoAviso]> = [
  ['Falha: trend não identificada — recarregue a página.', 'erro'],
  ['Falha: escreva o motivo do descarte — ele fica no histórico da trend.', 'erro'],
  ['Falha: essa trend já foi decidida em outra aba — recarregue a página.', 'erro'],
  ['Trend descartada — o motivo fica no histórico.', 'sucesso'],
  // Leva 4 — o painel de ajuste de nota (a válvula da dona):
  ['Falha: escreva a nota de viagem — um número inteiro de 0 a 100.', 'erro'],
  ['Falha: a nota de viagem é um número inteiro de 0 a 100.', 'erro'],
  ['Falha: não entendi o que fazer com a nota — recarregue a página.', 'erro'],
  ['Nota de viagem ajustada — a sua nota vale no lugar da nota do robô.', 'sucesso'],
  ['Ajuste de nota removido — volta a valer a nota do robô.', 'sucesso'],
  // Leva 5 — "Gerar roteiro" (o fim do Portão 1). As três últimas caem no
  // DETALHE DO POST, que ainda pinta pelo `FlashMsg` (`^falha|^não deu`): por
  // isso toda falha de lá começa com "Falha" e o acerto entra na lista de
  // sucesso de `tomDoAviso` — as duas réguas dão a mesma cor.
  ['Falha: não entendi de qual aba veio o pedido — recarregue a página.', 'erro'],
  ['Falha: a geração está desligada no servidor — nada foi criado e a trend continua na fila.', 'erro'],
  ['Falha: essa trend não está mais disponível — recarregue a página.', 'erro'],
  ['Falha: o roteiro não foi criado e nada mudou — tente de novo.', 'erro'],
  ['Roteiro na fila: o teto de roteiros de hoje já foi atingido — a rotina da manhã gera este.', 'sucesso'],
  ['Rascunho gerado — revise, edite e aprove. ✔', 'sucesso'],
  ['Falha: publique a voz da marca no Estúdio antes de gerar — o roteiro ficou na fila.', 'erro'],
  ['Falha: alguém já está gerando este roteiro — recarregue a página.', 'erro'],
  ['Falha na geração: «…»', 'erro'],
]

/**
 * O PAINEL DA PROFESSORA (issue #32). O desfecho dela saiu da URL e entrou no
 * cookie de flash, mas quem o pinta é o MESMO `AvisoLegado` — então a régua é a
 * mesma: frase nova sem entrada aqui = teste vermelho. Os quatro "Falha ao …"
 * soltos são o PREFIXO de `recusaParaTela(erro, contexto)`: a frase inteira
 * nasce em `src/data/teacher/recusas.ts` e é toda de erro (o teste dela cobra).
 */
const RECADOS_DA_PROFESSORA: ReadonlyArray<readonly [string, TomDoAviso]> = [
  // ---- cancelar e remarcar a própria aula (M2) ----
  ['Aula cancelada.«…» Os avisos ao aluno e à administração estão a caminho. ✅', 'sucesso'],
  // Os dois pedaços abaixo só existem DENTRO de "Aula cancelada.«…»" (acima): o tom
  // que vale é o da frase inteira; sozinhos, o default da régua os pinta de erro.
  ['O aluno ganhou 1 crédito de reposição«…».', 'erro'],
  ['O crédito não voltou sozinho — a administração foi avisada e resolve.', 'erro'],
  ['Aula remarcada. O e-mail ao aluno saiu; os demais avisos estão a caminho. ✅', 'sucesso'],
  [
    'Aula remarcada. ⚠️ O e-mail ao aluno não saiu — avise-o por outro canal. A administração recebe o seu motivo.',
    'erro',
  ],
  ['Falha: aula não identificada.', 'erro'],
  ['Falha: escreva o motivo do cancelamento — ele vai para a administração.', 'erro'],
  ['Falha: escreva o motivo — ele vai para a administração.', 'erro'],
  ['Falha: horário inválido — escolha de novo na lista.', 'erro'],
  // ---- janelas, bloqueios e Google ----
  ['Sua conta não está vinculada a uma professora.', 'erro'],
  ['Conflito: você já tem aula «…» — nenhum aluno conseguiria reservar essa janela. Escolha outro horário.', 'erro'],
  ['Conflito: sua agenda Google tem um compromisso «…» — escolha outro horário (ou libere o compromisso lá).', 'erro'],
  ['Janela publicada — seus alunos já a veem no portal. ✅', 'sucesso'],
  [
    'Janela publicada — seus alunos já a veem no portal. ✅ (não consegui checar seus compromissos do Google agora)',
    'erro', // sucesso parcial: o ato ficou, a conferência do Google não rodou
  ],
  ['Janela cancelada.', 'sucesso'],
  ['Janela semanal criada — os horários ofertáveis já a consideram. ✓', 'sucesso'],
  ['Janela semanal removida.', 'sucesso'],
  [
    'Bloqueio criado — nenhum horário será ofertado no período: os horários de remarcação já publicados nele saíram da oferta. Aulas já marcadas continuam: avise a administração para tratá-las.',
    'sucesso',
  ],
  ['Bloqueio removido.', 'sucesso'],
  ['Google Agenda desconectada — os eventos criados por aqui não somem sozinhos; apague-os lá se quiser.', 'sucesso'],
  ['O Google Agenda já estava desconectado.', 'sucesso'],
  ['Falha ao desconectar', 'erro'],
  // ---- plano do aluno e apontamento ----
  ['Plano do semestre pronto — personalize os módulos. ✓', 'sucesso'],
  ['Módulo atualizado. ✓', 'sucesso'],
  ['Sugestões prontas para «…» módulos — revise e aplique as que gostar. ✓', 'sucesso'],
  ['Conteúdo da aula apontado. ✓', 'sucesso'],
  ['Falha: apenas a professora do aluno (ou a admin).', 'erro'],
  ['Falha ao sugerir: não consegui gerar as sugestões agora. Nada foi alterado — tente de novo.', 'erro'],
  ['Falha ao gerar o plano', 'erro'],
  ['Falha ao salvar o módulo', 'erro'],
  ['Falha ao apontar', 'erro'],
]

/** A volta do consentimento do Google (`teacher/google/callback`). */
const RECADOS_DO_GOOGLE_CALLBACK: ReadonlyArray<readonly [string, TomDoAviso]> = [
  ['Integração com o Google ainda não está configurada no servidor.', 'erro'],
  ['Sua conta não está vinculada a uma professora.', 'erro'],
  ['Conexão cancelada — nada foi alterado.', 'sucesso'],
  ['A conexão expirou ou veio de outra aba — tente de novo pelo botão.', 'erro'],
  ['O Google recusou a troca de credenciais — tente de novo em instantes.', 'erro'],
  ['Falha ao salvar a conexão: não consegui gravar agora. Tente de novo em instantes.', 'erro'],
  ['Google Agenda conectada como «…». ✅ Suas aulas aparecem lá em instantes.', 'sucesso'],
  ['Google Agenda conectada. ✅ Suas aulas aparecem lá em instantes.', 'sucesso'],
]

/** O começo do consentimento do Google (`teacher/google/conectar`). */
const RECADOS_DO_GOOGLE_CONECTAR: ReadonlyArray<readonly [string, TomDoAviso]> = [
  ['Integração com o Google ainda não está configurada no servidor.', 'erro'],
  ['Sua conta não está vinculada a uma professora.', 'erro'],
]

/** Os módulos varridos: caminho no repo × o que ele tem direito de dizer. */
const FONTES: ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, TomDoAviso]>]> = [
  ['src/app/portal/actions.ts', RECADOS_DO_PORTAL],
  ['src/app/admin/alunos/actions.ts', RECADOS_DA_FICHA],
  ['src/app/admin/alunos/novo/actions.ts', RECADOS_DA_ADMISSAO],
  ['src/app/admin/contratos/actions.ts', RECADOS_DOS_CONTRATOS],
  ['src/app/admin/credit-actions.ts', RECADOS_DO_CREDITO],
  ['src/app/admin/agenda/actions.ts', RECADOS_DA_AGENDA],
  ['src/app/admin/ajustes/actions.ts', RECADOS_DOS_AJUSTES],
  ['src/app/admin/conteudo/pauta/actions.ts', RECADOS_DA_PAUTA],
  ['src/app/admin/conteudo/actions.ts', RECADOS_DO_RADAR],
  ['src/app/teacher/actions.ts', RECADOS_DA_PROFESSORA],
  ['src/app/teacher/google/callback/route.ts', RECADOS_DO_GOOGLE_CALLBACK],
  ['src/app/teacher/google/conectar/route.ts', RECADOS_DO_GOOGLE_CONECTAR],
]

describe('tomDoAviso — a ponte ?msg= → toast', () => {
  const raiz = path.resolve(__dirname, '..')

  for (const [arquivo, recados] of FONTES) {
    const naFonte = frasesDeTela(readFileSync(path.join(raiz, arquivo), 'utf8'))

    it(`a lista deste teste é EXATAMENTE o que ${arquivo} diz`, () => {
      const listadas = recados.map(([frase]) => frase)
      // Frase nova no módulo sem entrada aqui → aparece nesta diferença.
      expect([...naFonte].sort()).toEqual([...listadas].sort())
    })

    it(`cada frase de ${arquivo} sai com o tom certo`, () => {
      for (const [frase, tom] of recados) {
        expect(tomDoAviso(frase), frase).toBe(tom)
      }
    })
  }

  it('a recusa que NÃO abre com "Falha"/"Não deu" continua sendo vermelha', () => {
    // O defeito que originou a régua nova: estas quatro saíam em VERDE, com o
    // ✓ da casa, dizendo ao aluno que a reserva tinha dado certo.
    expect(tomDoAviso('Você não tem crédito suficiente para este agendamento.')).toBe('erro')
    expect(tomDoAviso('Esse horário acabou de ser reservado por outra pessoa — escolha outro.')).toBe('erro')
    expect(tomDoAviso('Faltam menos de 24h para o encontro — fale com a gente no WhatsApp.')).toBe('erro')
    expect(tomDoAviso('Sua próxima mentoria ainda não está liberada.')).toBe('erro')
  })

  it('frase desconhecida cai no vermelho (default seguro)', () => {
    expect(tomDoAviso('')).toBe('erro')
    expect(tomDoAviso('Qualquer coisa que ninguém listou.')).toBe('erro')
    // "falha" no meio da frase não é o que decide — quem decide é a lista.
    expect(tomDoAviso('Registramos a falha de conexão e seguimos. ✓')).toBe('erro')
  })

  it('o admin, que divide a mesma régua, continua com os acertos dele em verde', () => {
    // Estas telas usam o MESMO `AvisoLegado` (M3): virar o default para erro sem
    // listá-las pintaria de vermelho o convite que deu certo.
    expect(tomDoAviso('Convite enviado! 🎉 WhatsApp no cadastro.')).toBe('sucesso')
    expect(tomDoAviso('Aluno Marina Alves criado. ✓')).toBe('sucesso')
    expect(tomDoAviso('Lead Marina Alves criado. ✓')).toBe('sucesso')
    expect(tomDoAviso('Contrato e 2 horários criados. ✓')).toBe('sucesso')
    expect(tomDoAviso('Cadastro atualizado.')).toBe('sucesso')
    expect(tomDoAviso('Validade estendida — o crédito continua com a mesma duração e origem. ✓')).toBe('sucesso')
    // …e as recusas do admin, que também não abrem com "Falha", agora são vermelhas.
    expect(tomDoAviso('Falha: informe nome e cidade.')).toBe('erro')
    expect(tomDoAviso('FALHA ao enviar o convite.')).toBe('erro')
    expect(tomDoAviso('Aluno inválido.')).toBe('erro')
    expect(tomDoAviso('Contrato não encontrado.')).toBe('erro')
    expect(tomDoAviso('Pagador criado, mas o vínculo falhou: timeout')).toBe('erro')
  })

  /**
   * G2 + G3 — SUCESSO PARCIAL É VERMELHO, mesmo começando como acerto.
   *
   * As frases abaixo são as INSTANCIAÇÕES concretas das formas com cauda `«…»`
   * que as listas acima classificam pela base. Cada uma casa com um prefixo de
   * sucesso enumerado — e cada uma conta uma falha que a pessoa precisa
   * consertar (fuso não conferido, telefone perdido, ban do Auth em aberto).
   */
  it('o ato que só deu certo pela metade não sai com o ✓ da casa', () => {
    expect(tomDoAviso('Aluno Marina criado, mas a cidade não foi confirmada: timeout')).toBe('erro')
    // Correção 28/07 (rodada do Sol): o telefone deixou de ser sufixo — as
    // falhas de gravação viram `outcome.message` do PROVISIONAMENTO
    // (`src/lib/auth/provision.ts`), e é a instanciação DELAS que não pode sair
    // verde: nenhuma casa com prefixo enumerado, e as marcas de falha parcial
    // ("NÃO foi", ", mas") têm a palavra final.
    expect(
      tomDoAviso('Falha ao gravar o WhatsApp (timeout) — o convite NÃO foi reenviado. Tente de novo.'),
    ).toBe('erro')
    expect(
      tomDoAviso('O acesso já está ativo, mas o WhatsApp NÃO foi atualizado (timeout). Tente de novo.'),
    ).toBe('erro')
    expect(tomDoAviso('Login bloqueado, mas o aviso não foi baixado: 504 — clique de novo.')).toBe('erro')
    // …e o mesmo ato SEM o defeito continua verde: o marcador não pinta tudo de
    // vermelho, só o que confessa uma falha.
    expect(tomDoAviso('Aluno Marina criado. ✓')).toBe('sucesso')
    expect(tomDoAviso('Convite enviado! 🎉 WhatsApp no cadastro.')).toBe('sucesso')
    expect(tomDoAviso('Login bloqueado e credenciais embaralhadas. Anonimização concluída. ✓')).toBe('sucesso')
  })

  it('nenhum SUCESSO enumerado carrega um marcador de falha parcial', () => {
    // A rede que impede o marcador de virar armadilha: se uma frase de acerto
    // nova passar a dizer "…, mas …" ou "não foi", este teste fica vermelho —
    // e a decisão volta para a mesa (mudar a frase, nunca afrouxar o marcador).
    for (const [, recados] of FONTES) {
      for (const [frase, tom] of recados) {
        if (tom !== 'sucesso') continue
        expect(/,\s*mas\s|não\s+salvo|não\s+foi\b|falhou/i.test(frase), frase).toBe(false)
      }
    }
  })
})
