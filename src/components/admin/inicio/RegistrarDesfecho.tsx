'use client'

// AÇÃO CONTEXTUAL DO ANDAR "HOJE" (Onda 1 · M2): registrar o desfecho da aula
// que já passou e continua agendada — a pendência que trava o extrato da
// professora.
//
// Padrões da onda que este arquivo carrega:
// · overlay é o Sheet do KIT (foco preso, Esc, foco devolvido) — nada de
//   `<details data-popup>`;
// · feedback por TOAST, não por `?msg=` na URL;
// · uma FRASE sob cada opção dizendo a consequência (TutorBird §6);
// · o submit NUNCA nasce desabilitado; durante o envio o rótulo permanece e
//   entra o spinner (`data-pending`) — trocar o texto muda a largura e salta;
// · a hora vem pronta do servidor (Lei 1): aqui não se formata data.
import { useId, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { InstanteTexto, type Instante } from '@/components/kit/instant'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/kit/select'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetSection,
  SheetTitle,
  SheetTrigger,
} from '@/components/kit/sheet'
import { registrarDesfechoAction } from '@/data/admin/actions'
import type { ResultadoDaAcao } from '@/data/admin/action-result'

/**
 * "Nenhum tema à parte" — a opção PADRÃO, e a única que grava vazio.
 *
 * Sentinela de formulário, nunca valor gravado: o Select do kit (Radix) proíbe
 * item de valor vazio, e "seguir o módulo do plano" precisa de um valor para ser
 * escolhido. É o mesmo mecanismo do `PLANO_OUTRO` da admissão. O campo que a
 * action lê (`off_kind`) continua sendo UM só e continua recebendo `''` aqui.
 */
const TEMA_DO_PLANO = '__modulo_do_plano__'

const TEMAS = [
  { valor: TEMA_DO_PLANO, rotulo: 'módulo do plano (apontado pela professora)' },
  { valor: 'revisao', rotulo: 'revisão' },
  { valor: 'prova', rotulo: 'prova' },
  { valor: 'extra', rotulo: 'conteúdo extra' },
  { valor: 'conversacao', rotulo: 'conversação' },
  { valor: 'outro', rotulo: 'outro' },
]

/**
 * AS TRÊS FRASES, CORRIGIDAS NO A5/L5 — e o que elas diziam de errado.
 *
 * A matriz do desfecho vive em DUAS telas (aqui e na Agenda, `DesfechoDaAula`), e
 * duas telas não podem dizer coisas diferentes sobre o mesmo dinheiro. As frases
 * de lá foram medidas no corpo efetivo das funções (a tabela está em
 * `src/lib/admin/desfecho-da-aula.ts`); estas eram as duas que sobraram falsas:
 *
 * 1. "Conta como dada e LIBERA a hora da professora no extrato" —
 *    `_teacher_payable_hours` (`20260713000600`) soma
 *    `i.state in ('completed','no_show_student')` **ou**
 *    `i.state = 'scheduled'` sem pausa de contrato, com `starts_at_utc < now()`:
 *    a hora da aula que passou JÁ contava antes de qualquer registro. Registrar
 *    realizada MANTÉM a hora; não libera nada. (O movimento inverso é que
 *    existe: falta da professora e cancelamento a RETIRAM.)
 * 2. "O aluno ganha um crédito de reposição." — pode ser FALSO. Se a aula nasceu
 *    de crédito, `_mark_no_show` chama `_refund_for_credit_born_class`
 *    (`20260718000300`), que faz
 *    `if v_spend.consumes_ledger_id is null then o_blocked := …; return;` — volta
 *    SEM inserir no `makeup_ledger`. A frase passa a admitir a exceção.
 *
 * As frases são COPIADAS do vocabulário da Agenda, não importadas: a peça de lá
 * promete "o recado depois do registro diz o que de fato aconteceu, lido da
 * trilha", e a action DESTA tela (`registrarDesfechoAction`) não lê a trilha.
 * Importar a frase inteira traria uma promessa nova que esta tela não cumpre.
 */
const OPCOES = [
  {
    valor: 'aconteceu',
    rotulo: 'A aula aconteceu',
    frase:
      'Conta como dada: a hora CONTA no extrato da professora, e o aluno não ganha crédito de reposição.',
  },
  {
    valor: 'aluno_faltou',
    rotulo: 'O aluno faltou',
    frase:
      'Conta como dada mesmo assim: a hora CONTA no extrato da professora, e o aluno não ganha crédito de reposição.',
  },
  {
    valor: 'professora_faltou',
    rotulo: 'A professora faltou',
    frase:
      'A hora NÃO conta no extrato da professora. Em regra o aluno ganha um crédito de reposição — a exceção é a aula que nasceu de um crédito antigo sem identidade, em que o sistema não devolve sozinho; nesse caso confira o extrato de créditos dele na ficha.',
  },
] as const

export function RegistrarDesfecho({
  instanceId,
  quem,
  instante,
  revalidar,
}: {
  instanceId: string
  quem: string
  instante: Instante
  /** caminho da tela que chamou, quando não é o Início (ficha do aluno, M3-2) */
  revalidar?: string
}) {
  const [aberto, setAberto] = useState(false)
  const [escolha, setEscolha] = useState<string>('aconteceu')
  const [tema, setTema] = useState<string>(TEMA_DO_PLANO)
  const [enviando, iniciar] = useTransition()
  const grupo = useId()

  // O desfecho é decidido no BANCO (Lei 3); aqui só se leva o formulário e se
  // conta o que voltou. Fechar o painel e mostrar o toast acontece na própria
  // transição — nada de setState dentro de efeito.
  function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    const dados = new FormData(evento.currentTarget)
    iniciar(async () => {
      const resultado: ResultadoDaAcao = await registrarDesfechoAction(dados)
      if (resultado.ok) {
        toast.success(resultado.mensagem)
        setAberto(false)
      } else {
        toast.error(resultado.mensagem)
      }
    })
  }

  return (
    <Sheet open={aberto} onOpenChange={setAberto}>
      <SheetTrigger className="btn-ac-soft">Registrar</SheetTrigger>
      <SheetContent aria-describedby={`${grupo}-desc`}>
        <SheetHeader>
          <SheetTitle>Como foi a aula?</SheetTitle>
          <SheetDescription id={`${grupo}-desc`}>
            {quem} · <InstanteTexto value={instante} />
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={enviar} className="flex min-h-0 flex-1 flex-col">
          <input type="hidden" name="instance_id" value={instanceId} />
          {revalidar && <input type="hidden" name="revalidar" value={revalidar} />}
          <SheetBody>
            <SheetSection
              title="Desfecho da aula"
              hint="Cada opção diz, na frase abaixo dela, o que acontece com o extrato da professora e com o crédito do aluno."
            >
              <fieldset className="flex flex-col gap-2">
                <legend className="sr-only">Desfecho da aula</legend>
                {OPCOES.map((o) => (
                  <label
                    key={o.valor}
                    className={`flex cursor-pointer gap-3 rounded-card border p-3 transition-colors duration-(--duration-hover) ease-(--ease-out) ${
                      escolha === o.valor ? 'border-ac-deep bg-ac-wash' : 'border-line hover:bg-paper-100'
                    }`}
                  >
                    <input
                      type="radio"
                      name="desfecho"
                      value={o.valor}
                      checked={escolha === o.valor}
                      onChange={() => setEscolha(o.valor)}
                      className="mt-1 accent-ac-deep"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-ink-900">{o.rotulo}</span>
                      <span className="block text-sm leading-relaxed text-ink-600">{o.frase}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            </SheetSection>

            {escolha === 'aconteceu' && (
              <SheetSection
                title="O que foi trabalhado"
                hint="Deixe no módulo do plano quando a professora já apontou no painel dela."
              >
                {/* c12 · nº 16: era o `<select>` NATIVO — o menu do sistema
                    operacional que a objeção nº 1 do dono bane em tela nova, e
                    o único que restava na Onda 1. Vira o Select do kit (Radix:
                    teclado, ARIA e a pele do TutorBird), com `z-60` para subir
                    acima do véu do Sheet, que é `z-50`. O valor viaja num hidden
                    porque a sentinela do "módulo do plano" precisa virar `''`
                    para a action — o Radix proíbe item de valor vazio. */}
                <label
                  htmlFor="tema-do-desfecho"
                  className="flex flex-col gap-1 text-sm font-semibold text-ink-600"
                >
                  Tema
                </label>
                <Select value={tema} onValueChange={setTema}>
                  <SelectTrigger id="tema-do-desfecho" className="min-h-11 w-full font-normal">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-60">
                    {TEMAS.map((t) => (
                      <SelectItem key={t.valor} value={t.valor}>
                        {t.rotulo}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <input
                  type="hidden"
                  name="off_kind"
                  value={tema === TEMA_DO_PLANO ? '' : tema}
                />
                <label className="flex flex-col gap-1 text-sm font-semibold text-ink-600">
                  Detalhe (opcional)
                  <input
                    name="off_note"
                    placeholder="ex.: prova B2"
                    className="min-h-11 rounded-input border border-line bg-paper-0 px-3 text-sm font-normal text-ink-900 placeholder:text-ink-400"
                  />
                </label>
              </SheetSection>
            )}
          </SheetBody>

          {/* rodapé FIXO do kit — Cancelar à esquerda, ação sólida à direita, nunca
              some no scroll (anatomia medida no painel do TutorBird) */}
          <SheetFooter
            cancel={
              <button type="button" onClick={() => setAberto(false)} className="btn-ac-ghost">
                Cancelar
              </button>
            }
          >
            <button type="submit" className="btn-ac btn-ac-lg" data-pending={enviando ? '' : undefined}>
              Registrar
            </button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
