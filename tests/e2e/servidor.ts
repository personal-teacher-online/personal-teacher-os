// GLOBAL SETUP DO HARNESS (Onda 1 · M5) — quem sobe e derruba o app.
//
// POR QUE O SETUP SOBE O SERVIDOR, e não o mantenedor num terceiro terminal: o
// rito da onda tem de caber em DOIS comandos (`npm run e2e:bancada` e
// `npm run test:e2e`). Um servidor esquecido no ar de uma sessão anterior é a
// fonte clássica de e2e que "passa" contra código velho — por isso aqui há uma
// regra explícita, e desde o c13 ela é ESTREITA: o harness só reusa o que já
// está na porta quando é um build de PRODUÇÃO com o mesmo BUILD_ID do disco.
// Qualquer outra coisa (servidor de desenvolvimento, build de outra sessão,
// outro processo qualquer) PARA a suíte com o motivo dito.
//
// `next start`, e não `next dev`: a bancada tem de exercitar o mesmo bundle que
// vai para o Coolify, e o dev server compila rota por rota no primeiro acesso —
// o que transforma cada `goto` numa espera de segundos e faz o teste medir o
// compilador em vez da tela. Era esse mesmo argumento que o c12 contrariava ao
// aceitar reuso de dev server; o c13 (nº 7) o cumpre.
//
// A DECISÃO em si mora em `porta.ts`, sem efeito nenhum, e é testada por
// comportamento (`tests/c13-correcoes-sol-3.test.ts`). Aqui ficam só os efeitos:
// perguntar à porta, ler o disco, subir, esperar, derrubar.
//
// TZ=UTC (Lei 1): servidor sempre em UTC, como em produção. O relógio do
// NEGÓCIO é do banco (`business_today()`, America/Cuiaba) e não muda com isto —
// é justamente essa separação que o harness precisa exercitar.

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { BASE_URL, PORTA } from './harness'
import { decidirSobreAPorta, oQueAtende, type NaPorta } from './porta'

const RAIZ = path.resolve(__dirname, '..', '..')
const CAMINHO_DO_BUILD_ID = path.join(RAIZ, '.next', 'BUILD_ID')
const RITO = 'Rito: 1) npm run e2e:bancada   2) npm run test:e2e'
/** O que fazer com quem está na porta e não deveria estar. */
const DERRUBAR = `  lsof -ti tcp:${PORTA} | xargs kill`

let nosso: ChildProcess | null = null

async function quemAtende(): Promise<NaPorta> {
  let r: Response
  try {
    r = await fetch(`${BASE_URL}/login`, { redirect: 'manual' })
  } catch {
    return { estado: 'fora' }
  }
  return oQueAtende(r.status, await r.text())
}

/** O build que está no disco — o que `npm run e2e:bancada` acabou de gerar. */
function buildIdDoDisco(): string | null {
  if (!existsSync(CAMINHO_DO_BUILD_ID)) return null
  return readFileSync(CAMINHO_DO_BUILD_ID, 'utf8').trim()
}

async function esperar(segundos: number) {
  for (let i = 0; i < segundos * 2; i++) {
    const quem = await quemAtende()
    // Só o build conta como "subiu": é `next start` que estamos esperando.
    if (quem.estado === 'build') return
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`o app não atendeu em ${BASE_URL} depois de ${segundos}s.\n${RITO}`)
}

export async function setup() {
  const decisao = decidirSobreAPorta(await quemAtende(), buildIdDoDisco())

  if (decisao.tipo === 'parar') {
    throw new Error(`${decisao.motivo}\n${DERRUBAR}\n${RITO}`)
  }
  if (decisao.tipo === 'reusar') {
    console.log(`[e2e] reusando o servidor que já atende em ${BASE_URL} (build ${decisao.buildId})`)
    return
  }

  nosso = spawn('npx', ['next', 'start', '-p', String(PORTA)], {
    cwd: RAIZ,
    stdio: 'ignore',
    env: {
      ...process.env,
      // Lei 1: o servidor roda em UTC, como em produção.
      TZ: 'UTC',
      PORT: String(PORTA),
      // ⚠️ SEM ISTO O APP SOBE CEGO. O Vitest põe `NODE_ENV=test` no processo, e
      // o Next PULA o `.env.local` quando NODE_ENV é `test` — o servidor subia
      // sem NEXT_PUBLIC_SUPABASE_URL e sem BANCADA_AUTOLOGIN, e a entrada de
      // bancada respondia 404 (medido: o harness parava em `/dev-entrar`).
      // `next start` é servidor de produção; o ambiente dele tem de dizer isso.
      NODE_ENV: 'production',
    },
  })
  await esperar(60)
  console.log(`[e2e] servidor subido pelo harness em ${BASE_URL}`)
}

export async function teardown() {
  if (!nosso) return
  nosso.kill('SIGTERM')
  nosso = null
}
