'use client'

// Fundo WebGL das TELAS PÚBLICAS — 2ª geração (13/07/2026), calibrado no vídeo-
// gabarito do Termius (docs/design-video-kit.md §gabarito). Aprovado no login
// em 13/07 ("está perfeito") e estendido às demais públicas por decisão do
// mantenedor (mesma presença visual em toda a vitrine). A 1ª geração (fBm) foi
// descartada: ruído fractal lê como nuvens. Esta usa CAMPOS GAUSSIANOS
// ANALÍTICOS — a matemática dos "gradientes gigantes que se fundem" do
// gabarito — com controle exato de contraste/saturação via curva de tom.
//
// Alvos medidos do gabarito: ~27% preto, ~52% penumbra, ~21% aceso,
// saturação ~0.7, movimento contínuo, vida em todos os cantos, sem vinheta.
// Anti-loop: posições/respirações usam senos de frequências incomensuráveis —
// o estado conjunto NUNCA se repete (vantagem estrutural sobre vídeo).
//
// Bails (o fog CSS rico por baixo assume): prefers-reduced-motion, telas
// < 640px, WebGL indisponível ou shader com erro. Canvas OPACO (inclui a
// base #0A0A0F) — quando ativo, ele é a verdade visual da tela.

import { useEffect, useRef } from 'react'

const FRAG = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;

// Tokens (Design.md): base #0A0A0F; fog #8488D9/#48BED9; acentos #B35BD9/#2BD9D9
const vec3 BASE = vec3(0.039, 0.039, 0.059);
const vec3 PERIWINKLE = vec3(0.518, 0.533, 0.851);
const vec3 CYAN = vec3(0.282, 0.745, 0.851);
const vec3 TURQUOISE = vec3(0.169, 0.851, 0.851);
const vec3 VIOLET = vec3(0.702, 0.357, 0.851);

// Campo gaussiano anisotrópico: centro c, rotação th, escalas s, intensidade w
float field(vec2 p, vec2 c, float th, vec2 s, float w) {
  vec2 d = p - c;
  float co = cos(th), si = sin(th);
  d = vec2(co * d.x - si * d.y, si * d.x + co * d.y);
  d /= s;
  return w * exp(-dot(d, d));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = uv;
  p.x *= u_res.x / u_res.y;
  float t = u_time;

  vec3 acc = vec3(0.0);

  // 6 campos — frequências incomensuráveis (nunca repete), cobrindo os cantos.
  // c = centro base + órbita; th gira devagar; w respira.
  // 1: glow ciano dominante, direita
  acc += CYAN * field(p,
    vec2(1.45 + 0.30 * sin(t * 0.459), 0.52 + 0.26 * cos(t * 0.326)),
    0.5 + 0.30 * sin(t * 0.213), vec2(0.40, 0.24),
    0.62 + 0.20 * sin(t * 0.599));

  // 2: campo periwinkle, alto-esquerdo
  acc += PERIWINKLE * field(p,
    vec2(0.22 + 0.34 * sin(t * 0.374), 0.24 + 0.30 * cos(t * 0.500)),
    -0.5 + 0.2 * cos(t * 0.185), vec2(0.35, 0.19),
    0.50 + 0.22 * sin(t * 0.445 + 2.1));

  // 3: faixa diagonal larga (a "cortina"), atravessa o meio
  acc += mix(PERIWINKLE, CYAN, 0.5 + 0.5 * sin(t * 0.291)) * field(p,
    vec2(0.85 + 0.30 * sin(t * 0.206), 0.62 + 0.34 * cos(t * 0.410)),
    -0.42 + 0.1 * sin(t * 0.277), vec2(0.62, 0.13),
    0.40 + 0.18 * sin(t * 0.521 + 4.0));

  // 4: ciano inferior-esquerdo (canto vivo)
  acc += CYAN * field(p,
    vec2(0.18 + 0.15 * cos(t * 0.354), 0.88 + 0.28 * sin(t * 0.480)),
    0.3 + 0.2 * sin(t * 0.165), vec2(0.27, 0.18),
    0.43 + 0.22 * cos(t * 0.396 + 1.3));

  // 5: periwinkle inferior-direito (canto vivo)
  acc += PERIWINKLE * field(p,
    vec2(1.55 + 0.32 * sin(t * 0.311 + 3.0), 0.95 + 0.26 * cos(t * 0.528)),
    0.7 + 0.15 * cos(t * 0.235), vec2(0.31, 0.17),
    0.40 + 0.22 * sin(t * 0.340 + 5.2));

  // 6: acento violeta discreto, cruza o topo
  acc += VIOLET * field(p,
    vec2(0.75 + 0.45 * sin(t * 0.256 + 1.0), 0.12 + 0.24 * cos(t * 0.382)),
    0.2 * sin(t * 0.150), vec2(0.26, 0.14),
    0.20 + 0.10 * sin(t * 0.571 + 0.7));

  // núcleo turquesa dentro do glow dominante (pico de saturação, como no gabarito)
  acc += TURQUOISE * field(p,
    vec2(1.45 + 0.16 * sin(t * 0.459), 0.52 + 0.13 * cos(t * 0.326)),
    0.5, vec2(0.20, 0.12),
    0.25 + 0.11 * sin(t * 0.599));

  // Curva de tom: teto suave (nada estoura) + piso preto real
  float lum = dot(acc, vec3(0.2126, 0.7152, 0.0722));
  acc *= 1.0 / (1.0 + 1.5 * lum);

  // Reforço de saturação (o empilhamento lava; o gabarito é rico: ~0.7)
  float g = dot(acc, vec3(0.333));
  acc = clamp(mix(vec3(g), acc, 1.45), 0.0, 1.0);

  gl_FragColor = vec4(BASE + acc, 1.0);
}
`

const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`

export function FogGL() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (window.matchMedia('(max-width: 640px)').matches) return

    const gl = canvas.getContext('webgl', { alpha: false, antialias: false })
    if (!gl) return

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!
      gl.shaderSource(sh, src)
      gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('shader')
      return sh
    }

    let raf = 0
    try {
      const prog = gl.createProgram()!
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT))
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG))
      gl.linkProgram(prog)
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link')
      gl.useProgram(prog)

      const buf = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
      const loc = gl.getAttribLocation(prog, 'a_pos')
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

      const uRes = gl.getUniformLocation(prog, 'u_res')
      const uTime = gl.getUniformLocation(prog, 'u_time')

      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      const resize = () => {
        canvas.width = Math.floor(canvas.clientWidth * dpr)
        canvas.height = Math.floor(canvas.clientHeight * dpr)
        gl.viewport(0, 0, canvas.width, canvas.height)
        gl.uniform2f(uRes, canvas.width, canvas.height)
      }
      resize()
      window.addEventListener('resize', resize)

      // nasce em pleno movimento: offset inicial grande no relógio do shader
      const t0 = performance.now() - 60_000
      let hidden = false
      const onVis = () => {
        hidden = document.hidden
      }
      document.addEventListener('visibilitychange', onVis)

      const frame = () => {
        raf = requestAnimationFrame(frame)
        if (hidden) return
        gl.uniform1f(uTime, (performance.now() - t0) / 1000)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
      }
      frame()

      return () => {
        cancelAnimationFrame(raf)
        window.removeEventListener('resize', resize)
        document.removeEventListener('visibilitychange', onVis)
        gl.getExtension('WEBGL_lose_context')?.loseContext()
      }
    } catch {
      return
    }
  }, [])

  return (
    <div className="fog" aria-hidden="true" style={{ background: 'transparent' }}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  )
}
