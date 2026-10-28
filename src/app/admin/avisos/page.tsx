// MENSAGENS — M3-3a (Onda Agenda e Mensagens). A tela "Avisos" (lista das 200
// mais recentes filtrada em memória, `<details data-popup>` para resolver,
// recado por `?msg=`) morre aqui. A rota `/admin/avisos` fica: o trilho já a
// chama de "Mensagens", e Agenda e remarcação remetem para cá.
//
// ANATOMIA (molde: Financeiro/F1):
//   card-contêiner ← abas Todos | Presos | Aguardando | Enviados | Resolvidos
//     recorte      ← chips de período + seletor de aluno
//     conteúdo     ← tabela do kit (`ListaDeMensagens`), 50 por página
//     rodapé       ← paginação por link (a página é do servidor)
//   painel         ← `?ver=<id>`: o erro cru e o "resolver sem enviar"
//
// O RECORTE É DA CONSULTA: situação, período e aluno vão no WHERE e as
// contagens das abas são exatas (`src/data/admin/mensagens.ts`). Os links
// velhos `?st=preso&p=7` continuam chegando no mesmo recorte.
//
// FICA PARA O M3-3b (depois da migration M3-1): o estado "entregue" (aba
// Entregues), o "reenviar" no painel e a situação lida da view `outbox_admin`.
//
// Zero query nesta página: quem lê é `src/data/admin/mensagens.ts`.

import Link from 'next/link'
import type { ReactNode } from 'react'

import { ListaDeMensagens } from '@/components/admin/mensagens/ListaDeMensagens'
import { ResolverMensagem } from '@/components/admin/mensagens/ResolverMensagem'
import { SeletorDeAluno } from '@/components/admin/mensagens/SeletorDeAluno'
import { CardPanel, CardPanelTabs } from '@/components/kit/card-panel'
import { EmptyState } from '@/components/kit/empty-state'
import { PainelDeUrl } from '@/components/kit/painel-de-url'
import { Pill } from '@/components/kit/pill'
import { SheetSection } from '@/components/kit/sheet'
import { getMensagens, type MensagemAberta } from '@/data/admin/mensagens'
import {
  ABAS_DAS_MENSAGENS,
  PERIODOS_DAS_MENSAGENS,
  ROTULO_DA_SITUACAO,
  enderecoDasMensagens,
  lerFiltrosDasMensagens,
  type AbaDasMensagens,
  type FiltrosDasMensagens,
} from '@/data/admin/mensagens-gramatica'
import { cn } from '@/lib/cn'

export const metadata = { title: 'Mensagens — Admin' }

/** Estado vazio por aba — vazio nunca é a mesma frase para todos. */
const VAZIO: Record<AbaDasMensagens, { titulo: string; frase: string }> = {
  todos: {
    titulo: 'Nenhuma mensagem neste recorte.',
    // A6 · prova independente L2: o aviso de cancelamento só nasce nos canais
    // que a dona marcar na confirmação — a ressalva fica aqui, na tela de
    // destino, para não contradizer a frase da Agenda.
    frase:
      'As mensagens nascem sozinhas: lembrete de aula, cancelamento de aula (se a escolha de avisar estiver marcada), confirmação de remarcação, crédito vencendo e mentoria liberada.',
  },
  preso: {
    titulo: 'Nenhuma mensagem presa.',
    frase: 'É assim que deve ficar. Presa é a mensagem que não sai sem você — em geral, aluno sem login ou número fora do WhatsApp.',
  },
  pendente: {
    titulo: 'Nada aguardando envio.',
    frase: 'Lembretes nascem antes da hora e esperam aqui até o despachante enviá-los.',
  },
  enviado: {
    titulo: 'Nenhuma mensagem enviada neste recorte.',
    frase: 'Amplie o período ou escolha outro aluno.',
  },
  resolvido: {
    titulo: 'Nenhuma mensagem resolvida sem envio.',
    frase: 'Aparecem aqui as que você resolveu à mão e as que perderam o sentido antes de sair (crédito que já venceu, por exemplo).',
  },
}

const LEGENDA: Record<AbaDasMensagens, string> = {
  todos: 'Todas as mensagens',
  preso: 'Mensagens presas',
  pendente: 'Mensagens aguardando envio',
  enviado: 'Mensagens enviadas',
  resolvido: 'Mensagens resolvidas sem envio',
}

function Chip({ rotulo, href, ativo }: { rotulo: string; href: string; ativo: boolean }) {
  return (
    <Link
      href={href}
      aria-current={ativo ? 'page' : undefined}
      className={cn(
        'inline-flex min-h-9 items-center rounded-input px-3 text-sm transition-colors duration-(--duration-hover) ease-(--ease-in-out)',
        ativo ? 'bg-ac-wash font-semibold text-ac-deep' : 'font-medium text-ink-600 hover:bg-paper-100 hover:text-ink-900',
      )}
    >
      {rotulo}
    </Link>
  )
}

/** Rodapé de paginação por LINK — a página é do servidor e sobrevive ao F5. */
function Paginacao({
  filtros,
  pagina,
  totalDePaginas,
  primeira,
  ultima,
  total,
}: {
  filtros: FiltrosDasMensagens
  pagina: number
  totalDePaginas: number
  primeira: number
  ultima: number
  total: number
}) {
  const passo = (alvo: number, rotulo: string, simbolo: string, ativo: boolean) =>
    ativo ? (
      <Link
        href={enderecoDasMensagens(filtros, { pagina: alvo })}
        aria-label={rotulo}
        className="inline-flex h-9 w-9 items-center justify-center rounded-input text-sm font-semibold text-ink-900 transition-colors duration-(--duration-hover) ease-(--ease-in-out) hover:bg-paper-100"
      >
        {simbolo}
      </Link>
    ) : (
      <span aria-hidden className="inline-flex h-9 w-9 items-center justify-center rounded-input text-sm text-ink-600 opacity-40">
        {simbolo}
      </span>
    )

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-line px-4 py-3">
      <p className="text-sm font-medium tabular-nums text-ink-900">
        {primeira}–{ultima} de {total}
      </p>
      <nav aria-label="Paginação" className="flex items-center gap-1">
        {passo(pagina - 1, 'Página anterior', '‹', pagina > 1)}
        <span className="min-w-16 text-center text-sm font-medium tabular-nums text-ink-900">
          {pagina} de {totalDePaginas}
        </span>
        {passo(pagina + 1, 'Próxima página', '›', pagina < totalDePaginas)}
      </nav>
    </div>
  )
}

function Dado({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm text-ink-600">{rotulo}</dt>
      <dd className="text-sm font-medium text-ink-900">{children}</dd>
    </div>
  )
}

function CorpoDoPainel({ m, voltarPara }: { m: MensagemAberta; voltarPara: string }) {
  const r = ROTULO_DA_SITUACAO[m.situacao]
  return (
    <>
      <SheetSection title="Detalhes">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Dado rotulo="Situação">
            <Pill tone={r.tom}>{r.frase}</Pill>
          </Dado>
          <Dado rotulo="Canal">{m.canal === 'whatsapp' ? 'WhatsApp' : 'E-mail'}</Dado>
          <Dado rotulo="Criada">{m.criadaEm}</Dado>
          <Dado rotulo="Pode sair a partir de">{m.agendadaPara}</Dado>
          {m.enviadaEm && (
            <Dado rotulo={m.situacao === 'resolvido' ? 'Resolvida' : 'Enviada'}>{m.enviadaEm}</Dado>
          )}
          {m.contexto && <Dado rotulo="Sobre">{m.contexto}</Dado>}
        </dl>
      </SheetSection>

      {m.erro && (
        <SheetSection title={m.situacao === 'preso' ? 'Por que não saiu' : 'Motivo registrado'}>
          <pre className="rounded-input bg-paper-100 px-3 py-2 font-mono text-sm break-all whitespace-pre-wrap text-ink-900">
            {m.erro}
          </pre>
        </SheetSection>
      )}

      {m.resolvivel && (
        <SheetSection
          title="Resolver sem enviar"
          hint="Use quando o aluno já foi avisado por outro caminho ou a mensagem perdeu o sentido."
        >
          <ResolverMensagem id={m.id} voltarPara={voltarPara} />
        </SheetSection>
      )}
    </>
  )
}

export default async function MensagensPage({
  searchParams,
}: {
  searchParams: Promise<{ st?: string; p?: string; aluno?: string; pg?: string; ver?: string }>
}) {
  const filtros = lerFiltrosDasMensagens(await searchParams)
  const d = await getMensagens(filtros)
  // a página EFETIVA (ajustada ao total) é a que os links preservam
  const atual: FiltrosDasMensagens = { ...filtros, pagina: d.pagina }
  const voltarPara = enderecoDasMensagens(atual, { ver: null })

  const abas = ABAS_DAS_MENSAGENS.map(({ aba, rotulo }) => ({
    label: rotulo,
    href: enderecoDasMensagens(atual, { aba }),
    active: filtros.aba === aba,
    count: d.contagens[aba],
    badge:
      aba === 'preso' && d.contagens.preso > 0 && filtros.aba !== 'preso' ? (
        <Pill tone="danger">ação sua</Pill>
      ) : undefined,
  }))

  const linhas = d.linhas.map((m) => ({ ...m, href: enderecoDasMensagens(atual, { ver: m.id }) }))
  const total = d.contagens[filtros.aba]

  return (
    <main className="view-enter flex flex-col gap-6">
      <p className="max-w-2xl text-sm text-ink-600">
        Tudo o que o sistema mandou (ou vai mandar) por e-mail e WhatsApp. “Preso” precisa de você —
        em geral é aluno sem login ou número fora do WhatsApp.
      </p>

      <CardPanel>
        <CardPanelTabs tabs={abas} />

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-3 py-2">
          <nav aria-label="Período" className="flex flex-wrap items-center gap-1">
            {PERIODOS_DAS_MENSAGENS.map(({ periodo, rotulo }) => (
              <Chip
                key={periodo}
                rotulo={rotulo}
                href={enderecoDasMensagens(atual, { periodo })}
                ativo={filtros.periodo === periodo}
              />
            ))}
          </nav>
          <SeletorDeAluno key={filtros.aluno ?? 'todos'} alunos={d.alunos} filtros={atual} />
        </div>

        {filtros.aluno && !d.alunoEscolhido && (
          <p className="border-b border-line px-4 py-2 text-sm font-medium text-danger-700">
            O aluno deste endereço não existe mais. Escolha outro no seletor.
          </p>
        )}

        <ListaDeMensagens
          linhas={linhas}
          legenda={d.alunoEscolhido ? `${LEGENDA[filtros.aba]} de ${d.alunoEscolhido.nome}` : LEGENDA[filtros.aba]}
          vazio={
            <EmptyState
              illustration="/illustrations/tudo-em-dia.svg"
              title={VAZIO[filtros.aba].titulo}
              hint={VAZIO[filtros.aba].frase}
            />
          }
        />

        {total > 0 && (
          <Paginacao
            filtros={atual}
            pagina={d.pagina}
            totalDePaginas={d.totalDePaginas}
            primeira={d.primeira}
            ultima={d.ultima}
            total={total}
          />
        )}
      </CardPanel>

      {d.aberta === 'sumiu' && (
        <PainelDeUrl titulo="Mensagem não encontrada" voltarPara={voltarPara}>
          <p className="text-sm text-ink-900">
            Este endereço aponta para uma mensagem que não existe. Volte para a lista e abra outra.
          </p>
        </PainelDeUrl>
      )}
      {d.aberta && d.aberta !== 'sumiu' && (
        <PainelDeUrl
          key={d.aberta.id}
          titulo={d.aberta.tipo}
          descricao={`Para ${d.aberta.destinatario}`}
          voltarPara={voltarPara}
        >
          <CorpoDoPainel m={d.aberta} voltarPara={voltarPara} />
        </PainelDeUrl>
      )}
    </main>
  )
}
