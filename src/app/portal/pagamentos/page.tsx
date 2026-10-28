// PAGAMENTOS DO ALUNO (Onda do Portal · P5) — as mensalidades por COMPETÊNCIA,
// com o desfecho de cada uma dito na voz certa (o banco tem oito).
//
// O QUE MUDA AQUI. A tela tinha dois rótulos ("vencida" e "em aberto") e
// chamava de "paga" tudo o mais — inclusive a cobrança ESTORNADA, cujo valor
// voltou para o aluno, e a CANCELADA, que nunca existiu como dívida. Era a
// escola afirmando ter recebido o que devolveu. As vozes que faltavam entram
// pela mesma porta das duas antigas: `payment_situacao` no banco (migration
// 20260728000800) nomeia o desfecho e esta página só traduz o nome em frase
// (`src/lib/portal/pagamentos.ts`).
//
// Quem decide, decide no BANCO (Lei 3 e a lição do P3): "em aberto",
// "vencida" e "não-cobrável" saem de `payment_em_aberto`, `business_today()` e
// `payment_nao_cobravel`. Esta tela não tem lista de status, não tem relógio e
// não sabe o que é um `REFUNDED`.
//
// A COMPETÊNCIA É O AGRUPADOR (a IA: "faturas com status humano"): o aluno
// procura "a mensalidade de julho", não a linha nº 3. Cobrança sem competência
// registrada cai num balde nomeado no fim, em vez de sumir.
import { DateTime } from 'luxon'
import { fmtBRL, fmtCivilDate } from '@/lib/format'
import { payments, type PaymentRow } from '@/lib/portal/data'
import { rotuloDaCobranca, urgenciaDaCobranca, verboDoVencimento } from '@/lib/portal/pagamentos'
import { createClient } from '@/lib/supabase/server'
import { AvisoDeLeitura } from '@/components/portal/AvisoDeLeitura'
import { mostrarVazioAfirmativo } from '@/lib/portal/vazio'
import { EmptyState } from '@/components/kit/empty-state'
import { Pill } from '@/components/kit/pill'
import { WHATSAPP_ATENDIMENTO_URL } from '@/lib/contact'

export const metadata = { title: 'Pagamentos — Personal Teacher' }

const SEM_COMPETENCIA = 'Outras cobranças'

/** "julho/2026" a partir da competência. Nenhuma data de máquina na tela. */
function mesHumano(ym: string | null): string {
  if (!ym) return SEM_COMPETENCIA
  const d = DateTime.fromISO(`${ym}-01`).setLocale('pt-BR')
  return d.isValid ? d.toFormat('LLLL/yyyy') : SEM_COMPETENCIA
}

export default async function PagamentosPortalPage() {
  const supabase = await createClient()
  // O recado da última ação vem da MOLDURA do portal (`RecadoDoPortal`, no
  // layout): esta tela não lê `?msg=` — nenhuma tela do portal lê mais.
  const leitura = await payments(supabase)

  // Urgência primeiro (vencida → em aberto → paga → resolvida sem pagamento) e,
  // dentro do balde, o vencimento mais próximo na frente. A ordem é do banco no
  // que decide (a situação) e daqui no que é só arrumação.
  const cobrancas = [...leitura.dado].sort(
    (a, b) =>
      urgenciaDaCobranca(a.situacao) - urgenciaDaCobranca(b.situacao) ||
      (a.dueDate ?? '').localeCompare(b.dueDate ?? ''),
  )

  // Os grupos saem na ordem em que a lista já ordenada os apresenta: a
  // competência da cobrança mais urgente vem primeiro.
  const competencias = [...new Set(cobrancas.map((c) => mesHumano(c.referenceYm)))]
  const doGrupo = (nome: string) => cobrancas.filter((c) => mesHumano(c.referenceYm) === nome)

  return (
    <main className="flex flex-col gap-6">
      <header>
        <h1 className="title-page text-ink-900">Pagamentos</h1>
        <p className="mt-1 text-sm text-ink-600">Suas mensalidades e a situação de cada uma.</p>
      </header>

      {leitura.erro && <AvisoDeLeitura oQue="suas mensalidades" />}

      {cobrancas.length === 0
        ? // Afirmar "nenhuma cobrança" exige ter conseguido olhar: com a leitura
          // falhando, sobra o aviso (P3).
          mostrarVazioAfirmativo({ erro: leitura.erro, itens: cobrancas.length }) && (
            <EmptyState
              title="Nenhuma cobrança por aqui ainda."
              hint="Quando a primeira mensalidade for emitida, ela aparece nesta lista."
            />
          )
        : competencias.map((nome) => (
            <section key={nome} className="flex flex-col gap-3">
              <h2 className="title-section text-ink-900 first-letter:uppercase">{nome}</h2>
              <ul className="flex flex-col gap-2">
                {doGrupo(nome).map((c) => (
                  <li key={c.id}>
                    <Cobranca cobranca={c} />
                  </li>
                ))}
              </ul>
            </section>
          ))}

      {WHATSAPP_ATENDIMENTO_URL && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-sm text-ink-600">Alguma cobrança estranha?</p>
          <a href={WHATSAPP_ATENDIMENTO_URL} target="_blank" rel="noreferrer" className="btn-ac-soft">
            Fale com a gente no WhatsApp
          </a>
        </div>
      )}
    </main>
  )
}

/** Realce só onde há o que resolver — o mesmo `--card-state` do Início. */
const CARTAO_EM_AVISO = '[--card-edge:transparent] [--card-state:var(--glow-warn)]'

function Cobranca({ cobranca }: { cobranca: PaymentRow }) {
  const rotulo = rotuloDaCobranca(cobranca.situacao)
  const emAtraso = cobranca.situacao === 'em_atraso'

  return (
    <article className={`card-ac flex flex-col gap-2 p-4 ${emAtraso ? CARTAO_EM_AVISO : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-base font-semibold text-ink-900 tabular-nums">
          {cobranca.amountCents != null ? fmtBRL(cobranca.amountCents) : 'valor a confirmar'}
        </p>
        <Pill tone={rotulo.tom}>{rotulo.frase}</Pill>
      </div>

      {/* O VERBO É DA SITUAÇÃO, não do calendário: "vence em" só na cobrança
          que ainda está de pé (`verboDoVencimento`). */}
      <p className={`text-sm font-medium ${emAtraso ? 'text-warn-700' : 'text-ink-600'}`}>
        {cobranca.dueDate
          ? `${verboDoVencimento(cobranca.situacao)} ${fmtCivilDate(cobranca.dueDate)}`
          : 'sem data de vencimento registrada'}
      </p>

      {rotulo.explicacao && <p className="text-sm text-ink-600">{rotulo.explicacao}</p>}

      {/* F3: o botão VOLTOU — renderiza se e só se a view mandou a url (as
          duas guardas — posse self + origem asaas.com — são do banco; aqui
          não se decide nada). Alvo _blank: a fatura é do Asaas, não do portal. */}
      {cobranca.invoiceUrl && (
        <a
          href={cobranca.invoiceUrl}
          target="_blank"
          rel="noreferrer"
          className="btn-ac-soft self-start"
        >
          Abrir a fatura
        </a>
      )}
    </article>
  )
}
