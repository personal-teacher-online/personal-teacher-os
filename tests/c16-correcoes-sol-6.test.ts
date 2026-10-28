// LOTE c16 — a resposta à RODADA 6 do Sol, no recorte que a ADR-029 decidiu.
//
// A ADR-029 ("a integração Autentique conclui no gate 🔑") separou a cauda de
// achados em dois montes:
//
//  · o que depende do PROVEDOR REAL (r6 nº 1, 4, 5 e 6 — formato de id,
//    semântica exata dos erros GraphQL, ordem verdadeira dos webhooks) ficou
//    REGISTRADO para quando a chave existir, e a superfície de assinatura foi
//    DESLIGADA até lá (§1). Continuar iterando contra uma API imaginada é polir
//    o que ninguém pode conferir;
//  · o que é NOSSO, e portanto se corrige agora: a matriz de eventos (nº 3, o
//    grave), o aceite morto (nº 11), o teto que media UTF-16 (nº 12), o teto que
//    só existia na tela (nº 13), o diagnóstico do webhook que pisava em evento
//    processado (nº 10) e o rótulo que afirmava envio numa data de anexo (nº 8).
//
// O QUE ESTE ARQUIVO PROVA CONTRA O BANCO (bancada local):
//  · o CASAL: `signature.accepted` do primeiro signatário NÃO encerra o
//    documento, e `document.finished` encerra — inclusive na versão em que o
//    segundo RECUSA depois de o primeiro ter assinado;
//  · o teto do motivo do cancelamento é do Postgres, medido em code points (200
//    emojis passam; 201 caracteres não);
//  · o 502, ponta a ponta: ambíguo no cliente, reserva ABERTA no banco, retry
//    recusado — que é o comportamento vivo que o aceite morto do c14 descrevia
//    ao contrário.
//
// E O QUE ELE PROVA SEM BANCO: o interruptor da assinatura nos DOIS modos (a
// env presente e ausente, com a seção desenhada de verdade), a guarda do
// diagnóstico do webhook (com um cliente-dublê que registra a consulta montada)
// e a régua de code points do campo com teto.
import { readFileSync } from 'node:fs'
import { createHmac } from 'node:crypto'
import path from 'node:path'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'

import { handleAutentiqueWebhook } from '../src/lib/webhooks/autentique'
import {
  AutentiqueEnvioError,
  createDocumentForSignature,
  envioNaoCriouDocumento,
} from '../src/lib/autentique/client'
import { assinaturaLigada } from '@/lib/autentique/gate'
import { CampoComTeto, passouDoTeto } from '@/components/kit/campo-com-teto'
import { SecoesDoContrato } from '@/components/admin/contratos/detalhe'
import {
  ASSINATURA_ROTULO,
  AVISO_DA_ASSINATURA_DESLIGADA,
  PAINEIS_DE_ASSINATURA,
  PAINEIS_DO_CONTRATO,
  TETO_DO_MOTIVO,
  painelPedeAutentique,
} from '@/data/admin/contratos-gramatica'
import { TETO_DO_PLANO } from '@/data/admin/contrato-novo'
import type { FichaDoContrato } from '@/data/admin/contrato-detalhe'
import { clientAs, createAuthUser, serviceClient } from './helpers/auth'
import { connect, createPrivateContract } from './helpers/db'

const RAIZ = path.resolve(__dirname, '..')
const corpo = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8')
/** Código SEM comentários: comentário conta o que MORREU; o que vale é o código. */
const codigo = (rel: string) =>
  corpo(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const docNovo = () => 'c16doc' + crypto.randomUUID().replace(/-/g, '')

let sql: Sql
let admin: SupabaseClient
const service = serviceClient()

beforeAll(async () => {
  sql = connect(6)
  admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin c16'), 'admin')
})
afterAll(async () => {
  await sql.end()
})

/* ========================================================================== */
/* ADR-029 §1 · a superfície de assinatura vive atrás do gate 🔑               */
/* ========================================================================== */

describe('ADR-029 §1 · sem AUTENTIQUE_TOKEN não há superfície de assinatura', () => {
  it('o interruptor responde à env, e responde POR CHAMADA', () => {
    // Por chamada, e não por import: uma constante de módulo congelaria o valor
    // no primeiro `require` do processo — e aí nem o deploy nem o teste mudariam
    // a resposta.
    vi.stubEnv('AUTENTIQUE_TOKEN', '')
    expect(assinaturaLigada(), 'env vazia é env ausente').toBe(false)
    vi.stubEnv('AUTENTIQUE_TOKEN', 'token-de-verdade')
    expect(assinaturaLigada()).toBe(true)
    vi.unstubAllEnvs()
  })

  it('os três painéis que dependem da chave estão nomeados, e só eles', () => {
    expect([...PAINEIS_DE_ASSINATURA]).toEqual([
      'assinatura',
      'reserva-anexar',
      'reserva-cancelar',
    ])
    for (const p of PAINEIS_DO_CONTRATO) {
      expect(painelPedeAutentique(p), p).toBe(
        (PAINEIS_DE_ASSINATURA as readonly string[]).includes(p),
      )
    }
  })

  /* ---- o desenho, nos dois modos ---- */

  const BASE: FichaDoContrato = {
    id: 'c-1',
    tipo: 'private_1on1',
    quem: 'Aluna Teste',
    alunoId: 's-1',
    nivel: 'B1',
    plano: 'Plano teste',
    produto: 'Aulas particulares',
    experimental: false,
    situacao: 'active',
    situacaoRotulo: 'ativo',
    encerrado: false,
    professora: { id: 't-1', nome: 'Dona', idx: 0 },
    valorHora: 'R$ 150,00',
    valorHoraCampo: '150.00',
    mensalidade: null,
    mensalidadeCampo: '',
    politica: { remarcacoes: 4, avisoHoras: 24, validadeDias: 90, falhaDaEscolaDias: 180 },
    vigencia: { inicio: '01/07/2026', fim: null },
    renovacao: { de: null, para: null },
    pausas: [],
    pausado: false,
    grupo: null,
    fusoDoHorario: { iana: 'America/Cuiaba', rotulo: 'Cuiabá' },
    fusoConfirmado: true,
    horarios: [],
    horariosFechados: [],
    creditos: {
      saldo: 0,
      proximaValidade: null,
      validadeSugeridaIso: '2026-10-25',
      duracaoSugerida: 45,
      verEm: '/admin/alunos/s-1?aba=creditos',
    },
    assinaturas: [
      {
        id: 'sig-1',
        status: 'sent',
        rotulo: ASSINATURA_ROTULO.sent,
        documento: 'doc-1',
        reservadaEm: '20/07/2026 09:00',
        vinculadaEm: '20/07/2026 09:01',
        assinadaEm: null,
        terminal: false,
        reservaAberta: false,
      },
      {
        id: 'sig-2',
        status: 'pending',
        rotulo: ASSINATURA_ROTULO.pending,
        documento: null,
        reservadaEm: '21/07/2026 10:00',
        vinculadaEm: null,
        assinadaEm: null,
        terminal: true,
        reservaAberta: true,
      },
    ],
    pendencias: 0,
    destinos: [],
    ocupacao: [],
    hojeIso: '2026-07-27',
    viradaMaximaIso: '2026-09-21',
    viradaMinimaIso: '2026-07-27',
  }

  const desenhar = (assinatura: boolean) =>
    renderToStaticMarkup(h(SecoesDoContrato, { contrato: BASE, assinaturaLigada: assinatura }))

  it('DESLIGADO: a seção mostra o aviso honesto e NENHUMA porta de assinatura', () => {
    const html = desenhar(false)
    // a seção continua existindo (some a promessa, não o assunto)
    expect(html).toContain('Assinatura')
    expect(html).toContain(AVISO_DA_ASSINATURA_DESLIGADA)
    expect(html, 'e o aviso diz de que gate depende').toContain('🔑')
    // nenhum dos três painéis é oferecido…
    for (const painel of PAINEIS_DE_ASSINATURA) {
      expect(html, painel).not.toContain(`painel=${painel}`)
    }
    // …nem o botão de enviar, nem a lista de documentos
    expect(html).not.toContain('Enviar para assinatura')
    expect(html).not.toContain('Anexar id do documento')
    expect(html).not.toContain('Cancelar reserva')
    expect(html).not.toContain('Ver status')
    // e as outras quatro seções continuam inteiras: o gate é da assinatura, não
    // da tela
    for (const t of ['Dados &amp; valores', 'Vigência &amp; pausas', 'Horários fixos', 'Créditos']) {
      expect(html, t).toContain(t)
    }
    expect(html).toContain('painel=regras')
    expect(html).toContain('painel=credito')
  })

  it('LIGADO: tudo volta — botão, lista e os dois atos humanos da reserva aberta', () => {
    const html = desenhar(true)
    expect(html).not.toContain(AVISO_DA_ASSINATURA_DESLIGADA)
    expect(html).toContain('Enviar para assinatura')
    expect(html).toContain('href="/admin/contratos/c-1?painel=assinatura"')
    expect(html).toContain('href="/admin/contratos/c-1?painel=reserva-anexar&amp;alvo=sig-2"')
    expect(html).toContain('href="/admin/contratos/c-1?painel=reserva-cancelar&amp;alvo=sig-2"')
    expect(html).toContain('Ver status')
  })

  it('e o endereço colado não entra por baixo: os painéis têm a rede do redirect', () => {
    const p = codigo('src/components/admin/contratos/paineis.tsx')
    expect(p).toContain('if (!assinaturaLigada && painelPedeAutentique(painel)) redirect(self)')
    // a mesma rede do contrato encerrado, e ANTES de qualquer painel ser montado
    expect(p.indexOf('painelPedeAutentique(painel)')).toBeLessThan(p.indexOf("painel === 'regras'"))
    // quem lê a env é a PÁGINA, uma vez; os componentes recebem a resposta
    const page = codigo('src/app/admin/contratos/[id]/page.tsx')
    expect(page).toContain('const assinatura = assinaturaLigada()')
    expect(page).toContain('assinaturaLigada={assinatura}')
    for (const rel of [
      'src/components/admin/contratos/paineis.tsx',
      'src/components/admin/contratos/detalhe.tsx',
    ]) {
      expect(codigo(rel), `${rel} não pode ler env`).not.toContain('process.env')
    }
  })
})

/* ========================================================================== */
/* r6 nº 3 (GRAVE) · o aceite de UM signatário não encerra o documento         */
/* ========================================================================== */

describe('r6 nº 3 · contrato de CASAL: um assina, o documento continua aberto', () => {
  const SECRET = 'autentique-secret-c16'
  const evento = (type: string, documentId: string, assinatura = 'sig') => ({
    id: 'wbk_' + crypto.randomUUID().slice(0, 12),
    object: 'webhook',
    event: {
      id: 'aut_' + crypto.randomUUID().slice(0, 12),
      type,
      data: {
        object: { id: `${assinatura}_${crypto.randomUUID().slice(0, 8)}`, document: { id: documentId } },
      },
    },
  })
  async function entregar(evt: ReturnType<typeof evento>) {
    const rawBody = JSON.stringify(evt)
    return handleAutentiqueWebhook(service, {
      rawBody,
      signature: createHmac('sha256', SECRET).update(rawBody).digest('hex'),
      secret: SECRET,
    })
  }

  /** Um espelho de documento ENVIADO, pelo caminho abençoado (reserva + anexo). */
  async function documentoEnviado(): Promise<string> {
    const c = await createPrivateContract(sql)
    const reserva = await admin.rpc('admin_begin_signature', { p_contract: c.contractId })
    expect(reserva.error).toBeNull()
    const doc = docNovo()
    const anexo = await admin.rpc('admin_finish_signature', {
      p_signature: reserva.data as string,
      p_document_id: doc,
    })
    expect(anexo.error).toBeNull()
    return doc
  }

  const estado = async (doc: string) =>
    (
      await sql<{ status: string; signed_at: string | null }[]>`
        select status, signed_at from contract_signatures where provider_document_id = ${doc}`
    )[0]

  it('assinatura 1 de 2 → estado NÃO terminal; document.finished → assinado', async () => {
    const doc = await documentoEnviado()

    // O primeiro do casal assina. O provedor manda um evento POR ASSINATURA.
    expect((await entregar(evento('signature.accepted', doc, 'sigA'))).status).toBe(200)
    const meio = await estado(doc)
    expect(meio.status, 'um signatário não fecha o documento').toBe('viewed')
    expect(meio.signed_at, 'e não existe hora de assinatura de um documento inacabado').toBeNull()
    // "não terminal" é o que importa: é isso que mantém a consulta viva e deixa
    // o desfecho de verdade (ou a recusa do segundo) ainda poder acontecer.
    expect(['signed', 'refused', 'expired', 'cancelled']).not.toContain(meio.status)

    // O segundo assina, e o provedor fecha o DOCUMENTO.
    expect((await entregar(evento('document.finished', doc))).status).toBe(200)
    const fim = await estado(doc)
    expect(fim.status).toBe('signed')
    expect(fim.signed_at).not.toBeNull()

    // A trilha conta a história inteira (Lei 8): dois passos, não um.
    const [{ sig }] = await sql<{ sig: string }[]>`
      select id as sig from contract_signatures where provider_document_id = ${doc}`
    const trilha = await sql<{ diff: { from: string; to: string } }[]>`
      select diff from audit_log
       where action = 'apply_autentique_event' and entity_id = ${sig} order by id`
    expect(trilha.map((t) => `${t.diff.from}→${t.diff.to}`)).toEqual([
      'sent→viewed',
      'viewed→signed',
    ])
  })

  it('O QUE O BUG CUSTAVA: depois de um aceite, a RECUSA do segundo ainda vale', async () => {
    // Com `signature.accepted → signed` (terminal), este era o caminho perdido:
    // o app declarava assinado e a recusa do outro signatário virava no-op.
    const doc = await documentoEnviado()
    expect((await entregar(evento('signature.accepted', doc, 'sigA'))).status).toBe(200)
    expect((await entregar(evento('signature.rejected', doc, 'sigB'))).status).toBe(200)
    expect((await estado(doc)).status, 'uma recusa mata o documento inteiro').toBe('refused')
  })

  it('a matriz nova está nos DOIS lados, e o SQL é o espelho do TS', async () => {
    const ts = codigo('src/lib/webhooks/autentique.ts')
    expect(ts).toContain("'signature.accepted': 'viewed'")
    expect(ts).toContain("'document.finished': 'signed'")
    const [linha] = await sql<{ aceite: string; fim: string }[]>`
      select public.autentique_status_do_evento('signature.accepted') as aceite,
             public.autentique_status_do_evento('document.finished')  as fim`
    expect(linha.aceite).toBe('viewed')
    expect(linha.fim).toBe('signed')
  })

  it('e a consulta manual sempre concordou: só `every(signed)` é assinado', () => {
    const c = codigo('src/lib/autentique/client.ts')
    expect(c).toContain('signed: sigs.length > 0 && sigs.every((s) => s.signed)')
  })

  it('o rótulo do degrau intermediário não afirma o que o espelho não sabe', () => {
    // Ele cobre "abriu" e "assinou, faltando gente" — e a tabela tem UMA linha
    // por documento, sem signatário nenhum.
    expect(ASSINATURA_ROTULO.viewed).toBe('assinatura em andamento')
  })
})

/* ========================================================================== */
/* r6 nº 11 · o aceite morto do c14 vira o comportamento vivo                  */
/* ========================================================================== */

describe('r6 nº 11 · 502 é AMBÍGUO: a reserva fica aberta, ponta a ponta', () => {
  it('o cliente diz ambíguo, o banco fica com a reserva e o retry é recusado', async () => {
    const original = globalThis.fetch
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response('<html>bad gateway</html>', {
          status: 502,
          headers: { 'content-type': 'text/html' },
        }),
      )) as typeof fetch
    let erro: unknown
    try {
      await createDocumentForSignature(
        { token: 'token-de-teste', sandbox: true },
        { name: 'c16', pdf: Buffer.from('%PDF-1.4'), signerEmail: 'aluno@exemplo.com' },
      )
    } catch (e) {
      erro = e
    } finally {
      globalThis.fetch = original
    }
    expect(erro).toBeInstanceOf(AutentiqueEnvioError)
    expect((erro as AutentiqueEnvioError).certeza, 'o servidor pode ter quebrado DEPOIS de criar').toBe(
      'ambiguo',
    )
    // …e por isso a action NÃO chama o desfecho: a reserva fica como está.
    expect(envioNaoCriouDocumento(erro)).toBe(false)

    const c = await createPrivateContract(sql)
    const reserva = await admin.rpc('admin_begin_signature', { p_contract: c.contractId })
    expect(reserva.error).toBeNull()
    // (nenhum `admin_finish_signature` aqui — é ESSE o efeito do ambíguo)
    const [linha] = await sql<{ status: string; sent_at: string | null }[]>`
      select status, sent_at from contract_signatures where contract_id = ${c.contractId}`
    expect(linha.status, 'a reserva continua ABERTA').toBe('pending')
    expect(linha.sent_at, 'e sem carimbo de envio').toBeNull()

    const retry = await admin.rpc('admin_begin_signature', { p_contract: c.contractId })
    expect(retry.error, 'o segundo envio às cegas é recusado').not.toBeNull()
    expect(retry.error!.message).toMatch(/reserva de assinatura ABERTA/)
  })

  it('e o aceite do c14 deixou de descrever um caminho que não existe', () => {
    const t = corpo('tests/c14-correcoes-sol-4.test.ts')
    expect(t, 'o 502 não produz mais `failed`').not.toContain("p_error: 'Error: 502 do Autentique'")
    expect(t).toContain('certeza: nao-criou')
  })
})

/* ========================================================================== */
/* r6 nº 12 · o teto do plano sai do `maxLength` (que media UTF-16)            */
/* ========================================================================== */

describe('r6 nº 12 · o teto de tela conta CARACTERES, como o do banco', () => {
  const EMOJI = '👩‍🎓' // fora do BMP: `String.length` conta mais de um

  it('a régua do campo é de code points — 80 emojis cabem, 81 caracteres não', () => {
    const oitenta = '🙂'.repeat(TETO_DO_PLANO)
    expect(oitenta.length, 'em UTF-16 isto pareceria o dobro').toBe(TETO_DO_PLANO * 2)
    expect(passouDoTeto(oitenta, TETO_DO_PLANO), 'e cabe, porque o banco conta caracteres').toBe(
      false,
    )
    expect(passouDoTeto('🙂'.repeat(TETO_DO_PLANO + 1), TETO_DO_PLANO)).toBe(true)
    expect(passouDoTeto('a'.repeat(TETO_DO_PLANO), TETO_DO_PLANO)).toBe(false)
    expect(passouDoTeto('a'.repeat(TETO_DO_PLANO + 1), TETO_DO_PLANO)).toBe(true)
    expect(passouDoTeto('', TETO_DO_PLANO), 'campo vazio é assunto do `required`').toBe(false)
  })

  it('o campo renderizado não leva `maxlength` — ele avisa em vez de comer a tecla', () => {
    const html = renderToStaticMarkup(
      h(CampoComTeto, {
        name: 'plan_name',
        required: true,
        teto: TETO_DO_PLANO,
        frase: 'cabe em 80',
        defaultValue: EMOJI,
        className: 'campo',
      }),
    )
    expect(html).toContain('name="plan_name"')
    expect(html).toContain('required')
    expect(html, 'o atributo que truncava não pode voltar').not.toContain('maxlength')
    // e a frase não vaza para o HTML: ela só existe quando o teto estoura
    expect(html).not.toContain('cabe em 80')
  })

  it('as quatro portas do plano usam o campo novo, e nenhuma delas o `maxLength`', () => {
    for (const rel of [
      'src/app/admin/alunos/novo/EtapaDoContrato.tsx',
      'src/app/admin/contratos/novo/WizardDeContrato.tsx',
      'src/components/admin/contratos/paineis.tsx',
    ]) {
      const c = codigo(rel)
      expect(c, rel).toContain('teto={TETO_DO_PLANO}')
      expect(c, rel).not.toContain('maxLength={80}')
    }
    // `paineis.tsx` tem DUAS (regras e renovação) — as duas trocadas
    const p = codigo('src/components/admin/contratos/paineis.tsx')
    expect(p.match(/teto=\{TETO_DO_PLANO\}/g)).toHaveLength(2)
  })
})

/* ========================================================================== */
/* r6 nº 13 · o teto do motivo do cancelamento desce para a RPC                */
/* ========================================================================== */

describe('r6 nº 13 · o motivo do cancelamento tem teto NO BANCO', () => {
  /** Uma reserva ABERTA, pronta para ser cancelada. */
  async function reservaAberta(): Promise<string> {
    const c = await createPrivateContract(sql)
    const r = await admin.rpc('admin_begin_signature', { p_contract: c.contractId })
    expect(r.error).toBeNull()
    return r.data as string
  }
  const FRASE = 'confira antes no painel do Autentique se o documento existe'

  it('201 caracteres são recusados com frase de gente — e o número', async () => {
    const r = await admin.rpc('admin_cancel_signature', {
      p_signature: await reservaAberta(),
      p_confirm: FRASE,
      p_reason: 'x'.repeat(TETO_DO_MOTIVO + 1),
    })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/cabe em 200 caracteres/)
    expect(r.error!.message, 'e diz quanto a pessoa escreveu').toMatch(/201/)
  })

  it('200 EMOJIS passam: a conta é `char_length`, não UTF-16', async () => {
    // Este é o caso que o `maxLength={200}` da tela recusava — e que o banco,
    // que conta caracteres, sempre aceitou.
    const id = await reservaAberta()
    const motivo = '🙂'.repeat(TETO_DO_MOTIVO)
    expect(motivo.length).toBe(TETO_DO_MOTIVO * 2)
    const r = await admin.rpc('admin_cancel_signature', {
      p_signature: id,
      p_confirm: FRASE,
      p_reason: motivo,
    })
    expect(r.error).toBeNull()
    expect(r.data).toBe('failed')
    const [{ diff }] = await sql<{ diff: { motivo: string } }[]>`
      select diff from audit_log where action = 'cancel_signature' and entity_id = ${id}`
    expect([...diff.motivo].length, 'e o motivo inteiro foi para a trilha').toBe(TETO_DO_MOTIVO)
  })

  it('a tela antecipa o mesmo número, sem `maxLength`', () => {
    const p = codigo('src/components/admin/contratos/paineis.tsx')
    expect(p).toContain('teto={TETO_DO_MOTIVO}')
    expect(p).not.toContain('maxLength={200}')
    expect(TETO_DO_MOTIVO).toBe(200)
  })
})

/* ========================================================================== */
/* r6 nº 10 · o diagnóstico do webhook não pisa em evento já processado        */
/* ========================================================================== */

describe('r6 nº 10 · o rastro do evento preso não sobrescreve o do evento aplicado', () => {
  const SECRET = 'autentique-secret-c16-inbox'
  const evt = (documentId: string) => ({
    id: 'wbk_' + crypto.randomUUID().slice(0, 12),
    object: 'webhook',
    event: {
      id: 'aut_' + crypto.randomUUID().slice(0, 12),
      type: 'signature.viewed',
      data: { object: { id: 'sig_1', document: { id: documentId } } },
    },
  })

  it('a escrita do diagnóstico é condicionada a `processed_at is null`', async () => {
    /*
     * O dublê existe porque a corrida real (o anexo do documento aplicando o
     * evento entre a resposta NULL da RPC e este `update`) é de milissegundos e
     * não se provoca de fora. O que dá para provar sem inventar é o que a
     * função MONTA: quais filtros vão na consulta. O efeito desses filtros — que
     * uma linha já processada não é tocada — é a prova de baixo, contra o banco.
     */
    const chamadas: string[] = []
    const dubleDaEscrita = {
      eq: () => dubleDaEscrita,
      is: (coluna: string, valor: unknown) => {
        chamadas.push(`is:${coluna}=${String(valor)}`)
        return Promise.resolve({ error: null })
      },
    }
    const duble = {
      from: () => ({
        upsert: () => ({ select: () => Promise.resolve({ data: [{ id: 99 }], error: null }) }),
        update: (patch: Record<string, unknown>) => {
          chamadas.push(`update:${Object.keys(patch).sort().join(',')}`)
          return dubleDaEscrita
        },
      }),
      rpc: () => Promise.resolve({ data: null, error: null }),
    } as unknown as SupabaseClient

    const corpoCru = JSON.stringify(evt('doc-que-nao-existe'))
    const r = await handleAutentiqueWebhook(duble, {
      rawBody: corpoCru,
      signature: createHmac('sha256', SECRET).update(corpoCru).digest('hex'),
      secret: SECRET,
    })
    expect(r.status, 'Lei 6: o provedor nunca vê falha nossa').toBe(200)
    expect(chamadas).toEqual(['update:error', 'is:processed_at=null'])
  })

  it('e o filtro tem o efeito prometido: linha já processada não é reescrita', async () => {
    const [linha] = await sql<{ id: number }[]>`
      insert into webhook_inbox (source, event_id, payload, processed_at, error)
      values ('autentique', ${'c16-' + crypto.randomUUID()}, '{}'::jsonb, now(),
              'aplicado no anexo do documento (chegou antes do espelho existir)')
      returning id`
    const { error } = await service
      .from('webhook_inbox')
      .update({ error: 'documento ainda sem registro em contract_signatures' })
      .eq('id', linha.id)
      .is('processed_at', null)
    expect(error).toBeNull()
    const [depois] = await sql<{ error: string }[]>`
      select error from webhook_inbox where id = ${linha.id}`
    expect(depois.error, 'o rastro verdadeiro sobreviveu').toMatch(/aplicado no anexo/)
  })

  it('e a falha da própria escrita aparece na resposta (não some no vazio)', async () => {
    const duble = {
      from: () => ({
        upsert: () => ({ select: () => Promise.resolve({ data: [{ id: 7 }], error: null }) }),
        update: () => ({
          eq: () => ({ is: () => Promise.resolve({ error: { message: 'inbox fora do ar' } }) }),
        }),
      }),
      rpc: () => Promise.resolve({ data: null, error: null }),
    } as unknown as SupabaseClient
    const corpoCru = JSON.stringify(evt('doc-que-nao-existe'))
    const r = await handleAutentiqueWebhook(duble, {
      rawBody: corpoCru,
      signature: createHmac('sha256', SECRET).update(corpoCru).digest('hex'),
      secret: SECRET,
    })
    expect(r.status).toBe(200)
    expect(r.body.detail).toMatch(/não pôde ser gravado: inbox fora do ar/)
  })
})

/* ========================================================================== */
/* r6 nº 8 · "vinculado em" — a tela não afirma envio numa data de anexo       */
/* ========================================================================== */

describe('r6 nº 8 · o carimbo diz o que ele é', () => {
  it('a camada de dados e as duas telas falam de VÍNCULO, não de envio', () => {
    const d = codigo('src/data/admin/contrato-detalhe.ts')
    expect(d).toContain('vinculadaEm: a.sent_at ? fmtLocal(a.sent_at, BUSINESS_TZ) : null')
    expect(codigo('src/components/admin/contratos/detalhe.tsx')).toContain('`vinculado em ${a.vinculadaEm}`')
    expect(codigo('src/components/admin/contratos/paineis.tsx')).toContain('Documento vinculado em')
    for (const rel of [
      'src/components/admin/contratos/detalhe.tsx',
      'src/components/admin/contratos/paineis.tsx',
    ]) {
      expect(codigo(rel), `${rel} afirma envio numa data que pode ser do anexo`).not.toMatch(
        /enviado em/,
      )
    }
  })

  it('e o motivo do rótulo é real: a MESMA RPC serve o envio e o anexo humano', () => {
    // `admin_finish_signature` é chamada pela action logo depois de criar o
    // documento E por `attachSignatureDocumentAction`, horas depois. É ela que
    // escreve `sent_at` nos dois casos.
    const a = codigo('src/app/admin/contratos/actions.ts')
    const chamadas = a.match(/rpc\('admin_finish_signature'/g) ?? []
    expect(chamadas.length, 'duas portas, um carimbo').toBeGreaterThanOrEqual(2)
  })
})
