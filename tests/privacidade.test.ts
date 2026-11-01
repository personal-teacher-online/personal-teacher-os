// POLÍTICA DE PRIVACIDADE PÚBLICA (`/privacidade`, issue #135). Exigida pela
// Meta para publicar o app do WhatsApp (ADR-038, AN.5). O que se prende aqui:
//   - as seções obrigatórias existem, com a âncora `#exclusao`;
//   - e-mail de contato e data fixa estão na página;
//   - razão social/CNPJ só aparecem quando as envs existem, e nunca o marcador;
//   - a rota é pública, indexável, e os links "Privacidade" estão nas telas
//     públicas e no portal.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PoliticaDePrivacidade } from '@/components/privacidade/PoliticaDePrivacidade'
import { LinkPrivacidade } from '@/components/privacidade/LinkPrivacidade'
import { isPublicPath } from '@/lib/auth/gate'
import {
  PRIVACIDADE_ATUALIZADA_EM,
  PRIVACIDADE_EMAIL,
  controladoraDe,
} from '@/lib/privacidade'

const raiz = path.resolve(__dirname, '..')
const fonte = (rel: string) => readFileSync(path.join(raiz, rel), 'utf8')

const semEnv = controladoraDe({})
const htmlSem = renderToStaticMarkup(h(PoliticaDePrivacidade, { controladora: semEnv }))
const htmlCom = renderToStaticMarkup(
  h(PoliticaDePrivacidade, {
    controladora: controladoraDe({
      PRIVACIDADE_RAZAO_SOCIAL: 'Escola Ficticia Ltda',
      PRIVACIDADE_CNPJ: '00.000.000/0000-00',
    }),
  }),
)

describe('/privacidade — conteúdo', () => {
  it('traz todas as seções obrigatórias', () => {
    for (const titulo of [
      'O que guardamos',
      'Para que usamos',
      'Por quanto tempo guardamos',
      'Com quem compartilhamos',
      'Seus direitos',
      'Como pedir a exclusão dos seus dados',
      'Contato',
    ]) {
      expect(htmlSem, titulo).toContain(titulo)
    }
  })

  it('a âncora #exclusao existe e pertence à seção de exclusão', () => {
    expect(htmlSem).toMatch(/<section id="exclusao"[^>]*><h2[^>]*>Como pedir a exclusão/)
  })

  it('mostra o e-mail de contato e a data fixa de atualização', () => {
    expect(PRIVACIDADE_EMAIL).toBe('contato@pteacheracademy.com')
    expect(htmlSem).toContain(`mailto:${PRIVACIDADE_EMAIL}`)
    expect(htmlSem).toContain(PRIVACIDADE_ATUALIZADA_EM)
    expect(PRIVACIDADE_ATUALIZADA_EM).toMatch(/^\d{2}\/\d{2}\/\d{4}$/)
  })

  it('diz o que o sistema faz: 90 dias, ferramentas e canal de avisos', () => {
    expect(htmlSem).toContain('90 dias')
    for (const ferramenta of ['Meta', 'Resend', 'Google', 'Hotmart', 'Asaas', 'Alemanha', 'Cloudflare']) {
      expect(htmlSem, ferramenta).toContain(ferramenta)
    }
    // Claude: "podemos usar", nunca "usamos" (a Fase 4 ainda não entrou).
    expect(htmlSem).toContain('podemos usar')
  })

  it('nunca promete o que o sistema não faz', () => {
    expect(htmlSem.toLowerCase()).not.toContain('ponta a ponta')
    expect(htmlSem.toLowerCase()).not.toContain('criptograf')
  })

  it('sem as envs: só o nome fantasia, sem marcador, sem rótulo vazio', () => {
    expect(htmlSem).toContain('Personal Teacher Academy')
    expect(htmlSem).not.toContain('[[')
    expect(htmlSem).not.toContain('A PREENCHER')
    expect(htmlSem).not.toContain('Razão social')
    expect(htmlSem).not.toContain('CNPJ:')
  })

  it('com as envs: mostra razão social e CNPJ', () => {
    expect(htmlCom).toContain('Razão social: Escola Ficticia Ltda')
    expect(htmlCom).toContain('CNPJ: 00.000.000/0000-00')
    expect(htmlCom).not.toContain('[[')
  })
})

describe('/privacidade — controladoraDe', () => {
  it('vazio, só espaço ou marcador viram null (nunca vão para a tela)', () => {
    expect(controladoraDe({})).toEqual({ razaoSocial: null, cnpj: null })
    expect(controladoraDe({ PRIVACIDADE_RAZAO_SOCIAL: '  ', PRIVACIDADE_CNPJ: '' })).toEqual({
      razaoSocial: null,
      cnpj: null,
    })
    const marcador = '[[A PREENCHER PELO DONO]]'
    expect(
      controladoraDe({ PRIVACIDADE_RAZAO_SOCIAL: marcador, PRIVACIDADE_CNPJ: marcador }),
    ).toEqual({ razaoSocial: null, cnpj: null })
    const html = renderToStaticMarkup(
      h(PoliticaDePrivacidade, {
        controladora: controladoraDe({ PRIVACIDADE_CNPJ: marcador }),
      }),
    )
    expect(html).not.toContain('[[')
  })

  it('valor real passa aparado', () => {
    expect(controladoraDe({ PRIVACIDADE_CNPJ: ' 00.000.000/0000-00 ' }).cnpj).toBe(
      '00.000.000/0000-00',
    )
  })
})

describe('/privacidade — rota e links', () => {
  it('é pública para o gate', () => {
    expect(isPublicPath('/privacidade')).toBe(true)
    // página única: o que estiver pendurado embaixo NÃO herda a isenção
    expect(isPublicPath('/privacidade/x')).toBe(false)
  })

  it('a página tem o título combinado, é indexável e dinâmica', () => {
    const page = fonte('src/app/privacidade/page.tsx')
    expect(page).toContain("title: 'Política de Privacidade · Personal Teacher Academy'")
    expect(page).toContain('robots: { index: true, follow: true }')
    expect(page).toContain("export const dynamic = 'force-dynamic'")
    expect(page).not.toContain('noindex')
  })

  it('o link discreto aponta para /privacidade nas telas públicas e no portal', () => {
    expect(renderToStaticMarkup(h(LinkPrivacidade))).toContain('href="/privacidade"')
    // uma vez na capa noturna e uma na proposta clara, em cada uma das duas telas
    for (const rel of ['src/app/login/page.tsx', 'src/app/recuperar-senha/page.tsx']) {
      expect(fonte(rel), rel).toContain('<LinkPrivacidade />')
      expect(fonte(rel), rel).toContain('<LinkPrivacidade tom="claro" />')
    }
    expect(fonte('src/components/portal/PortalShell.tsx')).toContain('href="/privacidade"')
  })

  it('as envs novas estão documentadas no .env.example', () => {
    const exemplo = fonte('.env.example')
    expect(exemplo).toContain('PRIVACIDADE_RAZAO_SOCIAL=')
    expect(exemplo).toContain('PRIVACIDADE_CNPJ=')
  })
})
