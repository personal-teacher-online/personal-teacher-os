// Publica as artes de PRODUTO em public/brand/produtos/ (APROVADO do dono,
// 27/07/2026). Determinístico e re-rodável:
//  · Personal One — as 3 finais do lockup (hero 4:5 e quadrado 1:1 com
//    letreiro; card 922×400 sem letreiro, rótulo de card é HTML).
//  · Personal Travel — o banner enviado pelo dono (3840×1440) no CORTE SEGURO
//    2.3:1: janela x∈[424, 3736] centrada nos elementos (letreiro + a dona +
//    avião), reduzida para 922×400 — mesmo formato do card do One.
//
// Uso: node scripts/brand/publicar-produtos.mjs
//
// ── ATÉ ONDE VAI O "DETERMINÍSTICO E RE-RODÁVEL" (c12 · nº 21) ───────────────
// Na MÁQUINA DA CASA, e só nela. Os dois insumos ficam FORA do git por
// privacidade — `brand/ensaio fotográfico/` (as fotos da dona, de onde sai o
// lockup do One) e `brand/Logo Personal Travel/banner novo.jpg` (a arte que o
// dono enviou). Num clone limpo este script morre no primeiro `copyFileSync`,
// que é o comportamento correto: ele não deve inventar um substituto.
// O que É versionado: a receita (este arquivo, com os cortes e as medidas
// exatas) e os PRODUTOS FINAIS em `public/brand/produtos/` — que são o que o app
// serve, o que a revisão confere e o que os testes leem. Reproduzir do zero
// exige os insumos; conferir o resultado, não.
import { copyFileSync, mkdirSync } from 'node:fs'
import sharp from 'sharp'

const RAIZ = new URL('../../', import.meta.url).pathname
const LOCKUP = `${RAIZ}brand/ensaio fotográfico/lockup-personal-one`
const BANNER = `${RAIZ}brand/Logo Personal Travel/banner novo.jpg`
const DEST = `${RAIZ}public/brand/produtos`

mkdirSync(DEST, { recursive: true })

copyFileSync(`${LOCKUP}/personal-one-hero-4x5.jpg`, `${DEST}/personal-one-hero.jpg`)
copyFileSync(`${LOCKUP}/personal-one-quadrado-1x1.jpg`, `${DEST}/personal-one-quadrado.jpg`)
copyFileSync(`${LOCKUP}/personal-one-card-fundo-922x400.jpg`, `${DEST}/personal-one-card.jpg`)
console.log('✓ personal-one: hero, quadrado, card')

await sharp(BANNER)
  .extract({ left: 424, top: 0, width: 3312, height: 1440 })
  .resize(922, 400)
  .jpeg({ quality: 90 })
  .toFile(`${DEST}/personal-travel-card.jpg`)
console.log('✓ personal-travel-card (corte seguro 424–3736 → 922×400)')
