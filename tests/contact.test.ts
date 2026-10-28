// Canal de atendimento por config (plano do repositório público, passo 1a).
// O número da dona é dado pessoal: vem SÓ de WHATSAPP_ATENDIMENTO_E164. Sem a
// env, o código não inventa link nenhum — a função devolve null e cada tela
// decide não desenhar o botão. Teste puro, sem banco.
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { urlDeAtendimento } from '@/lib/contact'

const RAIZ = path.resolve(__dirname, '..')

/** Importa os módulos de novo com a env do momento (o link é lido na carga). */
async function carregar(e164: string | undefined) {
  vi.resetModules()
  if (e164 === undefined) vi.stubEnv('WHATSAPP_ATENDIMENTO_E164', '')
  else vi.stubEnv('WHATSAPP_ATENDIMENTO_E164', e164)
  const contact = await import('@/lib/contact')
  const avisos = await import('@/lib/email/class-notices')
  const briefing = await import('@/lib/email/briefing-reminder')
  return { contact, avisos, briefing }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('urlDeAtendimento', () => {
  it('sem número devolve null — nenhum padrão embutido', () => {
    expect(urlDeAtendimento(undefined)).toBeNull()
    expect(urlDeAtendimento('')).toBeNull()
    expect(urlDeAtendimento('   ')).toBeNull()
  })

  it('com número devolve o link wa.me só com dígitos (aceita o "+")', () => {
    expect(urlDeAtendimento('+5565900000001')).toBe('https://wa.me/5565900000001')
    expect(urlDeAtendimento('5565900000001')).toBe('https://wa.me/5565900000001')
  })
})

describe('constante e rodapé dos avisos', () => {
  it('sem a env: sem link e sem rodapé "fale com a gente"', async () => {
    const { contact, avisos } = await carregar(undefined)
    expect(contact.WHATSAPP_ATENDIMENTO_URL).toBeNull()
    expect(avisos.WA_FOOTER).toBe('')
  })

  it('com a env: o link e o rodapé citam wa.me/<número>', async () => {
    const { contact, avisos } = await carregar('+5565900000001')
    expect(contact.WHATSAPP_ATENDIMENTO_URL).toBe('https://wa.me/5565900000001')
    expect(avisos.WA_FOOTER).toContain('https://wa.me/5565900000001')
    expect(avisos.WA_FOOTER.endsWith('\n\n')).toBe(true)
  })

  it('o texto do lembrete sai sem rodapé nem linhas em branco sobrando quando não há número', async () => {
    const { briefing } = await carregar(undefined)
    const texto = briefing.briefingReminderText({ firstName: 'Ana' })
    expect(texto).not.toContain('wa.me')
    expect(texto).not.toContain('Dúvidas?')
    expect(texto).not.toMatch(/\n{3,}/)
    expect(texto.endsWith('Equipe Personal Teacher')).toBe(true)
  })

  it('e com número o mesmo texto ganha o rodapé antes da assinatura', async () => {
    const { briefing } = await carregar('+5565900000001')
    const texto = briefing.briefingReminderText({ firstName: 'Ana' })
    expect(texto).toContain('Dúvidas? Fale com a gente: https://wa.me/5565900000001\n\nEquipe Personal Teacher')
  })
})

describe('as frases não mandam ninguém para um WhatsApp que não existe', () => {
  it('sem número: "fale com a escola", sem citar WhatsApp', async () => {
    const { contact } = await carregar(undefined)
    expect(contact.FALE_COM_A_GENTE).toBe('fale com a escola')
    expect(contact.FALE_COM_A_GENTE_INICIAL).toBe('Fale com a escola')
    const aulas = await import('@/lib/portal/aulas')
    const frase = aulas.fraseDeCancelarAgora({
      efeito: 'ja_comecou',
      minNoticeHours: 24,
    } as Parameters<typeof aulas.fraseDeCancelarAgora>[0])
    expect(frase).toContain('Fale com a escola.')
    expect(frase).not.toMatch(/whatsapp/i)
  })

  it('com número: a frase de sempre', async () => {
    const { contact } = await carregar('+5565900000001')
    expect(contact.FALE_COM_A_GENTE).toBe('fale com a gente no WhatsApp')
    expect(contact.FALE_COM_A_GENTE_INICIAL).toBe('Fale com a gente no WhatsApp')
  })
})

describe('o código não carrega o número real de ninguém', () => {
  // Os números reais não ficam no repositório (público). A varredura de cada arquivo
  // compara só os DÍGITOS de cada linha (sem espaço, hífen, ponto, parênteses nem
  // "+"), então "(65) 9 xxxx-xxxx", "+55 65 9 xxxx xxxx" e "xxxxx.xxxx" caem igual.
  // O celular (9 dígitos) basta: o DDI e o DDD vêm antes dele. Quem guarda os números
  // reais é o ambiente do dono (PT_TELEFONES_REAIS, celulares de 9 dígitos separados
  // por vírgula); sem ela a checagem de arquivos não tem o que procurar, e o scanner
  // `scripts/vazamento.py` (CI) cobre o telefone de aparência real.
  const REAIS = (process.env.PT_TELEFONES_REAIS ?? '')
    .split(',')
    .map((numero) => numero.replace(/\D/g, ''))
    .filter((numero) => numero.length === 9)
  // Números inventados só para provar a varredura (montados em pedaços).
  const AMOSTRA_A = ['9', '8765', '4321'].join('')
  const AMOSTRA_B = ['9', '8123', '4567'].join('')
  const citaTelefone = (texto: string, numeros: string[]) =>
    texto.split('\n').some((linha) => {
      const digitos = linha.replace(/[\s().+-]/g, '')
      return numeros.some((numero) => digitos.includes(numero))
    })
  const citaTelefoneReal = (texto: string) => citaTelefone(texto, REAIS)

  const coletar = (dir: string, saida: string[]) => {
    for (const nome of readdirSync(dir)) {
      if (nome === 'node_modules') continue
      const p = path.join(dir, nome)
      if (statSync(p).isDirectory()) coletar(p, saida)
      else if (/\.(ts|tsx|mjs|sql|json)$/.test(nome) || nome === '.env.example') saida.push(p)
    }
  }
  const arquivos: string[] = []
  // `tests/fixtures` entra de propósito: é onde payload real de webhook costuma trazer o número
  for (const pasta of ['src', 'tests', 'scripts']) coletar(path.join(RAIZ, pasta), arquivos)
  arquivos.push(path.join(RAIZ, '.env.example'), path.join(RAIZ, 'supabase', 'seed.sql'))

  it('varre os arquivos de verdade, inclusive os fixtures', () => {
    expect(arquivos.length).toBeGreaterThan(200)
    expect(arquivos.some((p) => p.includes(`${path.sep}fixtures${path.sep}`))).toBe(true)
  })

  it.skipIf(REAIS.length === 0)('nenhum arquivo de src/, tests/, scripts/, .env.example ou seed cita os telefones reais', () => {
    const achados = arquivos.filter((p) => citaTelefoneReal(readFileSync(p, 'utf8')))
    expect(achados.map((p) => path.relative(RAIZ, p))).toEqual([])
  })

  it('a varredura pega o número em qualquer formato de escrita (arquivo temporário)', () => {
    const a = ['9', '8765', '4321']
    const b = ['9', '8123', '4567']
    const formatos = [
      `(65) ${a[0]} ${a[1]}-${a[2]}`,
      `+55 65 ${a[0]} ${a[1]} ${a[2]}`,
      `65 ${b[0]}${b[1]}.${b[2]}`,
      `+5565${b.join('')}`,
      `"display_phone_number": "55 65 ${a.join('')}"`,
    ]
    const pasta = mkdtempSync(path.join(tmpdir(), 'pt-varredura-'))
    try {
      for (const [i, formato] of formatos.entries()) {
        const arquivo = path.join(pasta, `payload-${i}.json`)
        writeFileSync(arquivo, `{\n  "x": 1,\n  "campo": "${formato}"\n}\n`)
        const achados: string[] = []
        coletar(pasta, achados)
        expect(
          achados.filter((p) => citaTelefone(readFileSync(p, 'utf8'), [AMOSTRA_A, AMOSTRA_B])),
          formato.replace(/\d/g, '#'),
        ).toContain(arquivo)
        rmSync(arquivo)
      }
    } finally {
      rmSync(pasta, { recursive: true, force: true })
    }
  })

  it('e não acusa número fictício nem ruído de ponto flutuante', () => {
    const amostras = [AMOSTRA_A, AMOSTRA_B]
    expect(citaTelefone('+5565900000001', amostras)).toBe(false)
    expect(citaTelefone('   0.012876543,', amostras)).toBe(false)
  })
})

describe('as telas só desenham o link de WhatsApp quando há número', () => {
  const telas: string[] = []
  const varrer = (dir: string) => {
    for (const nome of readdirSync(dir)) {
      const p = path.join(dir, nome)
      if (statSync(p).isDirectory()) varrer(p)
      else if (/\.tsx$/.test(nome)) telas.push(p)
    }
  }
  varrer(path.join(RAIZ, 'src'))
  const usam = telas.filter((p) => readFileSync(p, 'utf8').includes('href={WHATSAPP_ATENDIMENTO_URL}'))

  it('encontra as telas do portal que usam o link', () => {
    expect(usam.length).toBeGreaterThanOrEqual(10)
  })

  it.each(usam.map((p) => [path.relative(RAIZ, p), p]))('%s: todo href tem guarda', (_nome, p) => {
    const fonte = readFileSync(p, 'utf8')
    const guardas = fonte.match(/\{WHATSAPP_ATENDIMENTO_URL (&&|\?)/g)?.length ?? 0
    expect(guardas).toBeGreaterThanOrEqual(1)
    // nenhum href fora de um bloco guardado: tira os blocos guardados e vê o que sobra
    const semGuardados = fonte.replace(/\{WHATSAPP_ATENDIMENTO_URL (&&|\?)[\s\S]*?\n\s*(\)\}|\)\s*:)/g, '')
    expect(semGuardados).not.toContain('href={WHATSAPP_ATENDIMENTO_URL}')
  })
})
