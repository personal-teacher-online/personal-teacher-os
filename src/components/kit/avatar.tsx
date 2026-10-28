// AVATAR DE INICIAIS (Onda 1 · M3 · K3) — o círculo com duas letras que abre a
// linha do aluno na tabela, como na lista de Students do TutorBird (3ª passada:
// "avatar de iniciais colorido + nome-link + pill sob o nome").
//
// O que ele é: DECORAÇÃO ANCORADA. A cor é estável por id (o mesmo aluno tem
// sempre o mesmo círculo, e a memória visual da dona funciona), mas ela não
// carrega significado nenhum — quem diz produto, nível e acesso são as colunas.
// Por isso o elemento é `aria-hidden`: o nome do aluno está ao lado, e um leitor
// de tela anunciando "LP" antes de "Lúcia Prado" só atrapalha.
//
// Paleta: `--av0-tint … --av5-tint` (globals.css). Letra sempre em `--ink-900`,
// então nenhuma combinação pode falhar contraste — a cor não decide leitura.
import { cn } from '@/lib/cn'

/** As seis tintas do globals.css, na ordem dos tokens. */
export const AVATAR_TINTS = [
  'bg-(--av0-tint)',
  'bg-(--av1-tint)',
  'bg-(--av2-tint)',
  'bg-(--av3-tint)',
  'bg-(--av4-tint)',
  'bg-(--av5-tint)',
]

/**
 * Índice de cor a partir de uma semente qualquer (djb2 — barato, determinístico
 * e sem dependência). Estável entre servidor e cliente, que é o que importa:
 * cor sorteada no render daria hydration mismatch.
 */
export function indiceDaCor(semente: string): number {
  let h = 5381
  for (let i = 0; i < semente.length; i++) h = ((h << 5) + h + semente.charCodeAt(i)) >>> 0
  return h % AVATAR_TINTS.length
}

/**
 * Iniciais de um nome: primeira letra do primeiro nome + primeira letra do
 * último. Nome de uma palavra devolve UMA letra (não duas da mesma palavra, que
 * lê como sigla inventada). Nome anonimizado pela LGPD ("Ex-aluno(a) 3f2a")
 * cai no caminho comum sem tratamento especial: as letras saem de onde houver.
 */
export function iniciaisDe(nome: string): string {
  const partes = nome
    .split(/\s+/)
    .map((p) => p.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)
  if (partes.length === 0) return '?'
  const primeira = partes[0][0]
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : ''
  return (primeira + ultima).toUpperCase()
}

export function Avatar({
  nome,
  /** semente da cor — o id do aluno (estável para sempre) */
  id,
  className,
}: {
  nome: string
  id: string
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        // 36px é a medida da lista deles; `shrink-0` porque a célula do nome
        // pode apertar e um avatar oval é tell de layout mal resolvido.
        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-ink-900',
        AVATAR_TINTS[indiceDaCor(id)],
        className,
      )}
    >
      {iniciaisDe(nome)}
    </span>
  )
}
