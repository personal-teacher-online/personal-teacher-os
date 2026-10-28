// Gera a versão INTERATIVA do caderno cego — v2, RODADA 2 (roteiro único).
// Descartável, como o resto de scripts/calibracao-m2/.
//
//   node scripts/calibracao-m2/gerar-caderno-html.mjs
//
// Entrada: _rascunhos/calibracao-m2/caderno-cego-r2.md
// Saída:   _rascunhos/calibracao-m2/caderno-cego-r2.html
//
// O HTML não altera NADA do conteúdo julgado: só quebra o roteiro em blocos
// legíveis e recolhe nota + caixas + comentário. Formato desconhecido cai em
// <pre> cru — exibição nunca engole conteúdo.
//
// CEGAMENTO PRESERVADO: o gerador nem lê o gabarito; ordem = a do markdown.
// v2: roteiro único (duplo morreu na rodada 1) · labels com user-select:none e
// alvo de clique maior (bug relatado na rodada 1: seleção azul/estado voltando
// — abrir no Chrome/Safari, NUNCA no preview do VSCode).

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const BASE = join(AQUI, '..', '..', '_rascunhos', 'calibracao-m2')
const ENTRADA = join(BASE, 'caderno-cego-r2.md')
const SAIDA = join(BASE, 'caderno-cego-r2.html')

// ── Parse do markdown ────────────────────────────────────────────────────────

const md = readFileSync(ENTRADA, 'utf8')

const entregas = []
for (const bloco of md.split(/^## Entrega /m).slice(1)) {
  const cabecalho = bloco.slice(0, bloco.indexOf('\n'))
  const m = cabecalho.match(/^(\d+)\s*—\s*(.+)$/)
  if (!m) continue
  const cerca = bloco.match(/```\n([\s\S]*?)\n```/)
  if (!cerca) continue
  entregas.push({ n: m[1], titulo: m[2].trim(), roteiro: cerca[1] })
}

const CAMPOS_CENA = ['Fala', 'Texto na tela', 'Ação']

/** Quebra o roteiro em blocos. Tolerante: o que não casar vira texto solto. */
function parseRoteiro(texto) {
  const linhas = texto.split('\n')
  const blocos = []
  let atual = null

  const fecha = () => {
    if (atual) blocos.push(atual)
    atual = null
  }

  for (const linha of linhas) {
    const t = linha.trim()
    if (!t) continue

    let casou = false
    for (const [re, tipo] of [
      [/^GANCHO:\s*(.*)$/, 'gancho'],
      [/^VARIANTES DE GANCHO:\s*$/, 'variantes'],
      [/^CENA\s+(\d+)\s*$/, 'cena'],
      [/^CTA\s*$/, 'cta'],
      [/^LEGENDA\s*$/, 'legenda'],
    ]) {
      const m = t.match(re)
      if (!m) continue
      fecha()
      if (tipo === 'gancho') atual = { tipo, texto: m[1] }
      else if (tipo === 'variantes') atual = { tipo: 'variantes', itens: [] }
      else if (tipo === 'cena') atual = { tipo: 'cena', numero: m[1], campos: [] }
      else if (tipo === 'cta') atual = { tipo: 'cta', campos: [] }
      else atual = { tipo: 'legenda', linhas: [] }
      casou = true
      break
    }
    if (casou) continue

    const rodape = t.match(/^(HASHTAGS|DURAÇÃO-ALVO|TRILHA|NOTA DE PRODUÇÃO):\s*(.*)$/)
    if (rodape) {
      fecha()
      blocos.push({ tipo: 'rodape', rotulo: rodape[1], texto: rodape[2] })
      continue
    }

    const campo = t.match(/^(.+?):\s*(.*)$/)
    if (atual && (atual.tipo === 'cena' || atual.tipo === 'cta') && campo && CAMPOS_CENA.includes(campo[1])) {
      atual.campos.push({ rotulo: campo[1], texto: campo[2] })
      continue
    }
    if (atual?.tipo === 'variantes') {
      atual.itens.push(t.replace(/^\d+\.\s*/, ''))
      continue
    }
    if (atual?.tipo === 'legenda') {
      atual.linhas.push(t)
      continue
    }
    fecha()
    blocos.push({ tipo: 'solto', texto: t })
  }
  fecha()
  return blocos
}

const dados = entregas.map((e) => {
  const blocos = parseRoteiro(e.roteiro)
  const ok = blocos.some((b) => b.tipo === 'gancho') && blocos.some((b) => b.tipo === 'cena')
  return { n: e.n, titulo: e.titulo, blocos: ok ? blocos : null, cru: e.roteiro }
})

const semParse = dados.filter((d) => !d.blocos).length
console.log(`${dados.length} entregas · ${semParse} caíram no modo cru`)

// ── HTML ─────────────────────────────────────────────────────────────────────

const FLAGS = [
  ['fato_inventado', 'Inventou fato ou cena da vida da Teacher Vicky'],
  ['dado_de_aluno', 'Usou dado ou história de aluno'],
  ['incompleto', 'Roteiro incompleto — faltam blocos (gancho, cenas, CTA ou legenda)'],
  ['formato_quebrado', 'Formato quebrado — não dá para ler como roteiro'],
  ['trilha_sem_aviso', 'Usa música de terceiro sem o aviso da biblioteca'],
]

const json = JSON.stringify({ entregas: dados, flags: FLAGS })
  .replace(/</g, '\\u003c')
  .replace(/\u2028/g, String.raw`\u2028`)
  .replace(/\u2029/g, String.raw`\u2029`)

const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Caderno cego r2 — calibração do M2</title>
<style>
  :root {
    --bg: #fbfaf8; --card: #fff; --ink: #1d1b19; --suave: #6b6560;
    --linha: #e6e1da; --marca: #7a2f4f; --marca-fraca: #f4e9ee; --ok: #2f6b45;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #16151a; --card: #201e26; --ink: #ece9f0; --suave: #a09aa8;
      --linha: #34313d; --marca: #e6a3bf; --marca-fraca: #2f2530; --ok: #8fd4a8;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }
  header {
    position: sticky; top: 0; z-index: 10; background: var(--bg);
    border-bottom: 1px solid var(--linha); padding: 12px 20px;
    display: flex; gap: 16px; align-items: center; flex-wrap: wrap;
  }
  header h1 { font-size: 16px; margin: 0; font-weight: 650; }
  .progresso { color: var(--suave); font-size: 14px; }
  .barra { flex: 1; min-width: 120px; height: 6px; background: var(--linha); border-radius: 99px; overflow: hidden; }
  .barra i { display: block; height: 100%; width: 0; background: var(--ok); transition: width .2s; }
  button {
    font: inherit; cursor: pointer; border-radius: 8px; border: 1px solid var(--linha);
    background: var(--card); color: var(--ink); padding: 8px 14px;
  }
  button.principal { background: var(--marca); color: #fff; border-color: transparent; font-weight: 600; }
  main { max-width: 860px; margin: 0 auto; padding: 24px 20px 120px; }
  .aviso {
    background: var(--card); border: 1px solid var(--linha); border-radius: 12px;
    padding: 18px 22px; margin-bottom: 28px;
  }
  .aviso h2 { margin: 0 0 8px; font-size: 17px; }
  .aviso p { margin: 8px 0; }
  .aviso table { border-collapse: collapse; margin: 10px 0; font-size: 15px; }
  .aviso td { padding: 3px 14px 3px 0; }
  .aviso td:first-child { font-weight: 650; width: 28px; }
  .entrega {
    background: var(--card); border: 1px solid var(--linha); border-radius: 14px;
    padding: 22px 24px; margin-bottom: 26px;
  }
  .entrega.pronta { border-color: var(--ok); }
  .entrega > h2 { margin: 0 0 4px; font-size: 19px; }
  .numero { color: var(--suave); font-size: 13px; letter-spacing: .06em; text-transform: uppercase; }
  .roteiro { border: 1px solid var(--linha); border-radius: 10px; padding: 16px 18px; margin: 16px 0 4px; }
  .bloco { margin: 0 0 12px; }
  .rot { font-size: 11px; letter-spacing: .09em; text-transform: uppercase; color: var(--suave); margin-bottom: 2px; }
  .gancho { font-size: 18px; font-weight: 600; line-height: 1.4; }
  .variantes { margin: 0; padding-left: 18px; color: var(--suave); font-size: 14px; }
  .cena { border-left: 2px solid var(--linha); padding-left: 12px; margin-bottom: 12px; }
  .cena .cab { font-size: 11px; letter-spacing: .09em; text-transform: uppercase; color: var(--suave); margin-bottom: 4px; }
  .campo { margin-bottom: 5px; font-size: 15px; }
  .campo b { font-weight: 600; color: var(--suave); font-size: 13px; }
  .tela { background: var(--marca-fraca); border-radius: 6px; padding: 4px 8px; display: inline-block; }
  .rodape { font-size: 13px; color: var(--suave); border-top: 1px solid var(--linha); padding-top: 8px; margin-top: 10px; }
  .rodape div { margin-bottom: 3px; }
  pre { white-space: pre-wrap; font-size: 14px; background: var(--marca-fraca); padding: 12px; border-radius: 8px; overflow-x: auto; }
  .nota { border-top: 1px solid var(--linha); margin-top: 18px; padding-top: 16px; }
  .linha-nota { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }
  .linha-nota > span { font-weight: 650; }
  .notas { display: flex; gap: 6px; }
  .notas label {
    border: 1px solid var(--linha); border-radius: 8px; padding: 8px 16px; cursor: pointer;
    font-weight: 650;
  }
  .notas input { position: absolute; opacity: 0; pointer-events: none; }
  .notas label:has(input:checked) { background: var(--marca); color: #fff; border-color: transparent; }
  .ancora { color: var(--suave); font-size: 13px; }
  .flags { display: flex; flex-direction: column; gap: 2px; margin-bottom: 12px; }
  .flags label {
    display: flex; gap: 10px; align-items: center; font-size: 14px; cursor: pointer;
    padding: 6px 8px; border-radius: 8px;
  }
  .flags label:hover { background: var(--marca-fraca); }
  .flags input { width: 17px; height: 17px; flex: none; accent-color: var(--marca); }
  .flags label:has(input:checked) { color: #b3261e; font-weight: 600; }
  @media (prefers-color-scheme: dark) { .flags label:has(input:checked) { color: #f2b8b5; } }
  /* Bug relatado na rodada 1: clique rápido selecionava texto (flash azul) e o
     estado parecia "voltar". Controles não são texto selecionável. */
  .notas label, .flags label, button, header { -webkit-user-select: none; user-select: none; }
  textarea {
    width: 100%; min-height: 62px; resize: vertical; font: inherit; padding: 9px 11px;
    border-radius: 8px; border: 1px solid var(--linha); background: var(--bg); color: var(--ink);
  }
  .rodape-fixo {
    position: fixed; bottom: 0; left: 0; right: 0; background: var(--card);
    border-top: 1px solid var(--linha); padding: 12px 20px; display: flex;
    gap: 14px; align-items: center; justify-content: center; flex-wrap: wrap;
  }
  .estado { color: var(--suave); font-size: 13px; }
</style>
</head>
<body>
<header>
  <h1>Caderno cego — rodada 2 (roteiro único)</h1>
  <div class="barra"><i id="barra"></i></div>
  <div class="progresso" id="progresso">0 de 0</div>
</header>

<main>
  <div class="aviso">
    <h2>Como pontuar</h2>
    <p>São 10 entregas, embaralhadas e sem rótulo de origem. Cada premissa aparece duas vezes, escrita por dois motores diferentes — não dá para saber qual é qual, e é essa a ideia. Desta vez cada entrega é <b>um roteiro só, no registro trend</b>.</p>
    <p><b>Uma nota por entrega:</b> com este roteiro na mão, quão perto estou de postar?</p>
    <table>
      <tr><td>5</td><td>Postaria como está</td></tr>
      <tr><td>4</td><td>Ajustes leves</td></tr>
      <tr><td>3</td><td>Reescrita parcial</td></tr>
      <tr><td>2</td><td>Reescrita pesada</td></tr>
      <tr><td>1</td><td>Inutilizável</td></tr>
    </table>
    <p>E marque as caixas que se aplicarem. <b>Qualquer caixa marcada desclassifica a entrega</b>, independente da nota.</p>
    <p class="ancora">Abra esta página no Chrome ou Safari (não no preview do VSCode). O rascunho salva sozinho no navegador; para me entregar, clique em <b>Salvar respostas</b> no rodapé.</p>
  </div>
  <div id="lista"></div>
</main>

<div class="rodape-fixo">
  <span class="estado" id="estado">rascunho salvo no navegador</span>
  <button class="principal" id="salvar">Salvar respostas</button>
  <button id="copiar">Copiar para a área de transferência</button>
</div>

<script id="dados" type="application/json">${json}</script>
<script>
const DADOS = JSON.parse(document.getElementById('dados').textContent)
const CHAVE = 'calibracao-m2-r2-respostas'
const respostas = JSON.parse(localStorage.getItem(CHAVE) || '{}')

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))

function renderBlocos(blocos) {
  const corpo = blocos.filter((b) => b.tipo !== 'rodape')
  const rodape = blocos.filter((b) => b.tipo === 'rodape')
  return corpo.map((b) => {
    if (b.tipo === 'gancho') return '<div class="bloco"><div class="rot">Gancho</div><div class="gancho">' + esc(b.texto) + '</div></div>'
    if (b.tipo === 'variantes') return '<div class="bloco"><div class="rot">Outros ganchos possíveis</div><ul class="variantes">' + b.itens.map((i) => '<li>' + esc(i) + '</li>').join('') + '</ul></div>'
    if (b.tipo === 'cena' || b.tipo === 'cta') {
      const cab = b.tipo === 'cta' ? 'Chamada final' : 'Cena ' + b.numero
      return '<div class="cena"><div class="cab">' + cab + '</div>' + b.campos.map((c) => {
        const v = c.rotulo === 'Texto na tela' ? '<span class="tela">' + esc(c.texto) + '</span>' : esc(c.texto)
        return '<div class="campo"><b>' + esc(c.rotulo) + ':</b> ' + v + '</div>'
      }).join('') + '</div>'
    }
    if (b.tipo === 'legenda') return '<div class="bloco"><div class="rot">Legenda do post</div><div>' + b.linhas.map(esc).join('<br>') + '</div></div>'
    return '<div class="bloco">' + esc(b.texto) + '</div>'
  }).join('') +
  (rodape.length ? '<div class="rodape">' + rodape.map((b) => '<div><b>' + esc(b.rotulo) + ':</b> ' + esc(b.texto) + '</div>').join('') + '</div>' : '')
}

const lista = document.getElementById('lista')
lista.innerHTML = DADOS.entregas.map((e) => {
  const r = respostas[e.n] || {}
  const notas = [1,2,3,4,5].map((n) =>
    '<label><input type="radio" name="nota-' + e.n + '" value="' + n + '"' + (r.nota == n ? ' checked' : '') + '><span>' + n + '</span></label>'
  ).join('')
  const flags = DADOS.flags.map(([id, texto]) =>
    '<label><input type="checkbox" data-flag="' + id + '" data-n="' + e.n + '"' + ((r.flags||[]).includes(id) ? ' checked' : '') + '><span>' + esc(texto) + '</span></label>'
  ).join('')
  return '<section class="entrega" id="e' + e.n + '" data-n="' + e.n + '">' +
    '<div class="numero">Entrega ' + e.n + ' de ' + DADOS.entregas.length + '</div>' +
    '<h2>' + esc(e.titulo) + '</h2>' +
    '<div class="roteiro">' + (e.blocos ? renderBlocos(e.blocos) : '<pre>' + esc(e.cru) + '</pre>') + '</div>' +
    '<div class="nota">' +
      '<div class="linha-nota"><span>Nota:</span><div class="notas">' + notas + '</div>' +
      '<span class="ancora">5 posto como está · 1 inutilizável</span></div>' +
      '<div class="flags">' + flags + '</div>' +
      '<textarea placeholder="Comentário (opcional) — o que faria você subir a nota?" data-com="' + e.n + '">' + esc(r.comentario || '') + '</textarea>' +
    '</div>' +
  '</section>'
}).join('')

function guarda() {
  localStorage.setItem(CHAVE, JSON.stringify(respostas))
  const feitas = DADOS.entregas.filter((e) => respostas[e.n]?.nota).length
  document.getElementById('progresso').textContent = feitas + ' de ' + DADOS.entregas.length
  document.getElementById('barra').style.width = (feitas / DADOS.entregas.length * 100) + '%'
  DADOS.entregas.forEach((e) => {
    document.getElementById('e' + e.n).classList.toggle('pronta', Boolean(respostas[e.n]?.nota))
  })
  document.getElementById('estado').textContent = 'rascunho salvo no navegador · ' + new Date().toLocaleTimeString('pt-BR')
}

const pega = (n) => (respostas[n] = respostas[n] || { flags: [] })

lista.addEventListener('change', (ev) => {
  const alvo = ev.target
  if (alvo.type === 'radio') {
    pega(alvo.name.replace('nota-', '')).nota = Number(alvo.value)
  } else if (alvo.dataset.flag) {
    const r = pega(alvo.dataset.n)
    r.flags = r.flags || []
    if (alvo.checked) { if (!r.flags.includes(alvo.dataset.flag)) r.flags.push(alvo.dataset.flag) }
    else r.flags = r.flags.filter((f) => f !== alvo.dataset.flag)
  }
  guarda()
})
lista.addEventListener('input', (ev) => {
  if (ev.target.dataset.com) { pega(ev.target.dataset.com).comentario = ev.target.value; guarda() }
})

function payload() {
  return JSON.stringify({
    caderno: 'calibracao-m2-r2',
    salvo_em: new Date().toISOString(),
    respostas: DADOS.entregas.map((e) => ({
      entrega: e.n,
      titulo: e.titulo,
      nota: respostas[e.n]?.nota ?? null,
      desclassificam: respostas[e.n]?.flags ?? [],
      comentario: respostas[e.n]?.comentario ?? '',
    })),
  }, null, 2)
}

document.getElementById('salvar').addEventListener('click', async () => {
  const texto = payload()
  const nome = 'respostas-calibracao-m2-r2.json'
  if (window.showSaveFilePicker) {
    try {
      const h = await window.showSaveFilePicker({ suggestedName: nome,
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }] })
      const w = await h.createWritable(); await w.write(texto); await w.close()
      document.getElementById('estado').textContent = 'respostas gravadas em ' + h.name
      return
    } catch (err) { if (err.name === 'AbortError') return }
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([texto], { type: 'application/json' }))
  a.download = nome; a.click(); URL.revokeObjectURL(a.href)
  document.getElementById('estado').textContent = 'baixado como ' + nome + ' (mova para a pasta da calibração)'
})

document.getElementById('copiar').addEventListener('click', async () => {
  await navigator.clipboard.writeText(payload())
  document.getElementById('estado').textContent = 'respostas copiadas'
})

guarda()
</script>
</body>
</html>
`

writeFileSync(SAIDA, html)
console.log(`✔ ${SAIDA}`)
