'use client'

// O LOTE "TODAS ACONTECERAM" — o gesto por professora, no primitivo do kit (A7).
//
// ══════════════════════════════════════════════════════════════════════════════
// O QUE MUDA AQUI É A ROUPA. A REGRA NÃO MUDA NEM UM PONTO.
// ══════════════════════════════════════════════════════════════════════════════
// Este componente substitui o `ConfirmAction` de `components/ui.tsx`, que é um
// `<details data-popup>` — o padrão que o AGENTS.md proíbe em tela nova e que o
// A5 já matou no balão do evento. O que ele NÃO substitui é nada do que o portão
// de deploy de 29/07 (bloqueador 1) e a rodada 3 do Sol no A1 escreveram:
//
//   · o gesto continua sendo POR PROFESSORA (S2-7): sem filtro, o botão nem
//     existe — quem decide isso é a página, e a trava de verdade é do servidor
//     (`completeAllPendingAction` recusa envio sem `teacher_id`);
//   · continua em DOIS PASSOS: tocar não registra nada, confirmar registra;
//   · o botão continua contando e enviando SÓ o que pode concluir, e os IDs vão
//     EXPLÍCITOS — a RPC valida um a um e aborta tudo se a fila mudou;
//   · o aviso continua dizendo quantas ficam de fora e por quê;
//   · o desfecho continua saindo do número REAL que o banco devolveu.
//
// Este arquivo não escreve NENHUMA frase: título, aviso e rótulo de confirmação
// chegam prontos da página, que é onde as contagens são feitas. Escrever frase
// de dinheiro numa segunda superfície é o defeito que o A5 passou o milestone
// matando — aqui o componente é moldura, não voz.
//
// ── AS REGRAS DO PRIMITIVO, AS MESMAS DO `ConfirmarDesfecho` ────────────────
// 1. o `<form>` fica por FORA do rodapé (aqui ele embrulha o gatilho), e o
//    conteúdo do diálogo vive num portal — CAMPO desenhado lá dentro não seria
//    enviado, então os ocultos ficam junto do gatilho;
// 2. o `AlertDialogAction` do Radix fecha o diálogo no próprio `onClick` e
//    desmonta o botão antes de o navegador executar o submit padrão: o envio é
//    EXPLÍCITO (`preventDefault()` + `requestSubmit()` no formulário do
//    gatilho, que continua montado);
// 3. `z-index` é do primitivo — esta peça não passa classe de empilhamento.

import { useRef, useState, type MouseEvent } from 'react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/kit/alert-dialog'

export function ConfirmarLote({
  rotulo,
  aviso,
  confirmar: rotuloDeConfirmar,
  action,
  campos,
  className,
}: {
  /** o texto do gatilho — já com a contagem, feita pela página */
  rotulo: string
  /** o que a confirmação faz, em frase de gente (também da página) */
  aviso: string
  /** o texto do botão que EXECUTA */
  confirmar: string
  action: (formData: FormData) => Promise<void> | void
  /** os ocultos que a action lê (professora, IDs, endereço de volta) */
  campos: Record<string, string>
  className: string
}) {
  const gatilho = useRef<HTMLButtonElement>(null)
  // ABERTURA CONTROLADA (mesma nota do `ConfirmarDesfecho`): `preventDefault()`
  // no clique de confirmar faz o Radix NÃO fechar, e a caixa ficaria aberta com
  // o botão vivo durante o envio — um segundo toque mandaria um segundo lote.
  const [aberto, setAberto] = useState(false)

  function executar(e: MouseEvent<HTMLButtonElement>) {
    e.preventDefault()
    setAberto(false)
    gatilho.current?.form?.requestSubmit()
  }

  return (
    <form action={action}>
      {Object.entries(campos).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <AlertDialog open={aberto} onOpenChange={setAberto}>
        <AlertDialogTrigger asChild>
          {/* `type="button"`: dentro de um `<form>`, botão sem tipo É submit — e
              este abre a caixa, não registra nada. */}
          <button ref={gatilho} type="button" className={className}>
            {rotulo}
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{rotulo}</AlertDialogTitle>
            <AlertDialogDescription>
              {/* DADO que decide, não texto de apoio: piso literal da régua
                  (`text-sm`, `text-ink-900`). É esta frase que diz quantas aulas
                  entram, quantas ficam de fora e o que isso faz com o extrato. */}
              <span className="block text-sm leading-snug font-medium text-ink-900">{aviso}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction asChild>
              {/* Registrar aula realizada é ato de tinta, não de perigo — a mesma
                  escolha de cor do `ConfirmarDesfecho` para o desfecho positivo. */}
              <button type="submit" className="btn-ink" onClick={executar}>
                {rotuloDeConfirmar}
              </button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  )
}
