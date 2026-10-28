// Duas service accounts coabitam (21/07): a Fábrica de Conteúdo em
// GOOGLE_SERVICE_ACCOUNT_JSON e a de Slides em GOOGLE_SERVICE_ACCOUNT_B64.
// Escolher a errada faz o destino do deck "sumir" — regressão do 1º deck real.
import { afterEach, describe, expect, it } from 'vitest'
import { googleClientsFromEnv } from '../src/lib/google/slides'

const KEY = {
  client_email: 'x@exemplo.com',
  // chave de teste (não é segredo real): só precisa existir para o JWT montar
  private_key: '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n',
}
const jsonConteudo = JSON.stringify({ ...KEY, client_email: 'fabrica-conteudo@exemplo.com' })
const jsonSlides = JSON.stringify({ ...KEY, client_email: 'ptos-slides@exemplo.com' })

const prev = { ...process.env }
afterEach(() => {
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = prev.GOOGLE_SERVICE_ACCOUNT_JSON
  process.env.GOOGLE_SERVICE_ACCOUNT_B64 = prev.GOOGLE_SERVICE_ACCOUNT_B64
})

function emailOf(c: ReturnType<typeof googleClientsFromEnv>): string {
  // @ts-expect-error — leitura do JWT interno só para o teste
  return c!.drive.context._options.auth.email as string
}

describe('escolha da service account', () => {
  it('preferB64 usa a conta dos slides mesmo com a JSON de conteúdo presente', () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = jsonConteudo
    process.env.GOOGLE_SERVICE_ACCOUNT_B64 = Buffer.from(jsonSlides).toString('base64')
    expect(emailOf(googleClientsFromEnv({ preferB64: true }))).toContain('ptos-slides')
  })

  it('sem preferB64 mantém o comportamento das rotinas antigas (JSON)', () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = jsonConteudo
    process.env.GOOGLE_SERVICE_ACCOUNT_B64 = Buffer.from(jsonSlides).toString('base64')
    expect(emailOf(googleClientsFromEnv())).toContain('fabrica-conteudo')
  })

  it('cai para a outra fonte quando a preferida falta', () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_B64
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = jsonConteudo
    expect(emailOf(googleClientsFromEnv({ preferB64: true }))).toContain('fabrica-conteudo')
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON
    process.env.GOOGLE_SERVICE_ACCOUNT_B64 = Buffer.from(jsonSlides).toString('base64')
    expect(emailOf(googleClientsFromEnv())).toContain('ptos-slides')
  })

  it('sem nenhuma env devolve null', () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON
    delete process.env.GOOGLE_SERVICE_ACCOUNT_B64
    expect(googleClientsFromEnv({ preferB64: true })).toBeNull()
  })
})
