import { CopyButton } from '@/components/CopyButton'
import { Card, SectionTitle } from '@/components/ui'
import { parseRoteiroExibicao, type CenaExibicao } from '@/lib/content/roteiro'

// A VISÃO DE GRAVAÇÃO do roteiro de reel (M3). Server-safe de propósito: nenhuma
// action, nenhum hook, nada de client — assim o Vitest renderiza e prova as
// regras de "bloco vazio não renderiza" sem levantar navegador (precedente:
// components/admin/alunos/ficha/briefing-leitura.tsx).
//
// A LEITURA é aqui; a EDIÇÃO continua na textarea do formulário abaixo, que é o
// texto cru. Quando o parser não reconhece o formato, esta visão não tenta
// adivinhar: mostra o texto como está.

/** Rótulo de campo — RÓTULO é dado de leitura, piso text-sm (régua do AGENTS). */
function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <p className="text-sm text-ink-900">
      <span className="font-semibold text-ink-600">{rotulo}: </span>
      {children}
    </p>
  )
}

function Cena({ cena, titulo }: { cena: CenaExibicao; titulo: string }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-card border border-line-soft bg-paper-50 p-3">
      <span className="text-xs font-bold tracking-wide text-ink-400 uppercase">{titulo}</span>
      {cena.fala && <Campo rotulo="Fala">{cena.fala}</Campo>}
      {cena.textoNaTela && (
        <p className="text-sm text-ink-900">
          <span className="font-semibold text-ink-600">Texto na tela: </span>
          <span className="rounded-chip bg-paper-100 px-1.5 py-0.5">{cena.textoNaTela}</span>
        </p>
      )}
      {cena.acao && <Campo rotulo="Ação">{cena.acao}</Campo>}
      {cena.extras.map((linha, i) => (
        <p key={i} className="text-sm text-ink-600">
          {linha}
        </p>
      ))}
    </div>
  )
}

export function RoteiroVisao({ texto }: { texto: string }) {
  const lido = parseRoteiroExibicao(texto)

  // Formato irreconhecível: entrega o texto inteiro, com uma frase que explica a
  // troca sem jargão. Fonte de corpo (mono é proibida para texto corrido).
  if (!lido.ok) {
    return (
      <section className="flex flex-col gap-2">
        <SectionTitle>Roteiro</SectionTitle>
        <p className="text-sm text-ink-600">
          Este roteiro está num formato próprio — mostrando o texto como está.
        </p>
        <Card className="p-4">
          <pre className="font-sans text-sm whitespace-pre-wrap text-ink-900">{texto}</pre>
        </Card>
      </section>
    )
  }

  const r = lido.valor

  return (
    <section className="flex flex-col gap-3">
      <SectionTitle action={<CopyButton text={texto} label="Copiar roteiro" />}>
        Roteiro
      </SectionTitle>

      {r.extrasDoTopo.length > 0 && (
        <Card className="flex flex-col gap-1 p-4">
          {r.extrasDoTopo.map((linha, i) => (
            <p key={i} className="text-sm text-ink-600">
              {linha}
            </p>
          ))}
        </Card>
      )}

      {r.gancho && (
        <Card className="flex flex-col gap-2 p-4">
          <span className="text-xs font-bold tracking-wide text-ink-400 uppercase">
            Gancho — os primeiros segundos
          </span>
          <p className="font-display text-lg font-bold text-ink-900">{r.gancho}</p>
          {r.variantes.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-ink-600">Outros ganchos possíveis:</span>
              {/* Empilhados e com quebra, NÃO como chip do kit: variante de
                  gancho é uma FRASE que ela lê e escolhe, não um rótulo — o
                  `whitespace-nowrap` do chip vazava da tela a 390px, e o
                  text-xs dele fica abaixo do piso de legibilidade para dado. */}
              <ul className="flex flex-col gap-1.5">
                {r.variantes.map((t, i) => (
                  <li
                    key={i}
                    className="rounded-chip border border-line bg-paper-0 px-3 py-1.5 text-sm text-ink-900"
                  >
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {r.cenas.map((c, i) => (
        <Cena key={i} cena={c} titulo={`Cena ${c.numero}`} />
      ))}

      {r.cta && (
        <Cena
          cena={{ numero: '', fala: r.cta.fala, textoNaTela: r.cta.textoNaTela, extras: r.cta.extras }}
          titulo="Chamada final"
        />
      )}

      {r.legenda && (
        <Card className="flex flex-col gap-2 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-xs font-bold tracking-wide text-ink-400 uppercase">
              Legenda do post
            </span>
            <CopyButton text={r.legenda} label="Copiar legenda" />
          </div>
          <p className="text-sm whitespace-pre-wrap text-ink-900">{r.legenda}</p>
        </Card>
      )}

      {(r.hashtags || r.duracaoAlvoS || r.trilha || r.notaDeProducao) && (
        <Card className="flex flex-col gap-2 p-4">
          <span className="text-xs font-bold tracking-wide text-ink-400 uppercase">
            Para publicar
          </span>
          {r.hashtags && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-ink-900">{r.hashtags.join(' ')}</span>
              <CopyButton text={r.hashtags.join(' ')} label="Copiar hashtags" />
            </div>
          )}
          {r.duracaoAlvoS && (
            <Campo rotulo="Duração-alvo">{`${r.duracaoAlvoS} segundos`}</Campo>
          )}
          {r.trilha && <Campo rotulo="Trilha">{r.trilha}</Campo>}
          {r.notaDeProducao && <Campo rotulo="Nota de produção">{r.notaDeProducao}</Campo>}
        </Card>
      )}
    </section>
  )
}
