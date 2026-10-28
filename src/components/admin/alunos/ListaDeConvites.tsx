'use client'

// A LISTA DA ABA CONVITES (Onda 1 · M3-3 · N4) — a tabela do kit vestida com as
// colunas da pergunta "quem entra no portal?".
//
// Por que é uma tabela PRÓPRIA e não a `ListaDeAlunos` com outro recorte: as
// colunas respondem a outra pergunta (e-mail, situação de acesso, ação), e a
// coluna de identidade — a única igual — é importada de lá, não copiada.
//
// Por que é componente CLIENTE: o `DataTable` recebe as células como FUNÇÃO
// (`celula: (linha) => ReactNode`), e função não atravessa a fronteira RSC. O
// mesmo motivo da `ListaDeAlunos`. Nenhum estado vive aqui.
//
// A AÇÃO DA LINHA é a MESMA de sempre:
//  · sem convite → leva ao painel `?painel=convidar` da ficha, que é onde o
//    e-mail e o WhatsApp são preenchidos (o convite sempre morou lá);
//  · convite pendente → `resendInviteAction`, a action da ficha velha, com o
//    `back` apontando para esta aba (só o DESTINO do recado mudou).
// A action chega por PROP, vinda da página (Server Component), em vez de ser
// importada aqui: importar um módulo `'use server'` de dentro do pacote do
// cliente registraria TODAS as actions daquele arquivo — inclusive a de
// anonimizar — como endpoint alcançável pelo navegador. Todas são
// admin-guarded, mas superfície que não precisa existir não deve existir.
// A célula da ação sobe (`relative z-10`) acima da capa do link da linha —
// sem isso o botão ficaria embaixo do `::after` que amplia a âncora.
//
// Lei 1: nenhuma data é formatada aqui. `convidadoEm` chega pronta do servidor.

import Link from 'next/link'
import type { ReactNode } from 'react'

import { DataTable, type AcaoDeLinha, type ColunaDeTabela } from '@/components/kit/data-table'
import { Pill, type PillTone } from '@/components/kit/pill'
import { ACESSO_ROTULO, type AlunoDaLista } from '@/data/admin/alunos-grupos'
import { ColunaIdentidade } from './ListaDeAlunos'

const ACESSO_TOM: Record<AlunoDaLista['acesso'], PillTone> = {
  ativo: 'ok',
  pendente: 'warn',
  sem_convite: 'neutral',
}

/**
 * O estado + a CONSEQUÊNCIA declarada, no padrão que o TutorBird usa no painel
 * de presença ("Absent, Issue Make-Up Credit (Billable)"): a pílula diz o
 * estado, a frase diz o que isso significa para o aluno. A frase é DADO — é
 * ela que responde "e daí?" —, então 14px em cinza legível.
 */
function fraseDoAcesso(aluno: AlunoDaLista): string {
  if (aluno.acesso === 'ativo') return 'já criou a senha e entra no portal'
  if (aluno.acesso === 'pendente')
    return aluno.convidadoEm
      ? `convite enviado em ${aluno.convidadoEm} — ainda não criou a senha`
      : 'convite enviado — ainda não criou a senha'
  return 'ainda não recebeu convite nenhum'
}

export function ListaDeConvites({
  alunos,
  vazio,
  voltarPara,
  reenviarConvite,
}: {
  alunos: AlunoDaLista[]
  vazio: ReactNode
  /** para onde a action volta com o recado (esta aba, com o recorte aberto) */
  voltarPara: string
  /** `resendInviteAction`, entregue pela página */
  reenviarConvite: (formData: FormData) => void | Promise<void>
}) {
  const colunas: ColunaDeTabela<AlunoDaLista>[] = [
    {
      id: 'aluno',
      cabecalho: 'Aluno',
      celula: (a) => <ColunaIdentidade aluno={a} />,
    },
    {
      id: 'email',
      cabecalho: 'E-mail',
      ocultarAte: 'md',
      celula: (a) => (
        <span className="flex flex-col gap-0.5">
          <span className="text-sm break-all text-ink-900">{a.email ?? '—'}</span>
          {a.emailDevolvido && (
            <span className="text-sm font-semibold text-danger-700">
              devolvido pelo servidor — confira o endereço
            </span>
          )}
        </span>
      ),
    },
    {
      id: 'acesso',
      cabecalho: 'Situação de acesso',
      celula: (a) => (
        <span className="flex flex-col items-start gap-1">
          <Pill tone={ACESSO_TOM[a.acesso]}>{ACESSO_ROTULO[a.acesso]}</Pill>
          <span className="text-sm text-ink-600">{fraseDoAcesso(a)}</span>
        </span>
      ),
    },
    {
      id: 'acao',
      cabecalho: 'Ação',
      cabecalhoOculto: true,
      celula: (a) => {
        if (a.acesso === 'ativo') return null
        return (
          <span className="relative z-10 flex justify-end">
            {a.acesso === 'sem_convite' ? (
              <Link href={`/admin/alunos/${a.id}?painel=convidar`} className="btn-ac-soft">
                Convidar
              </Link>
            ) : (
              <form action={reenviarConvite}>
                <input type="hidden" name="student_id" value={a.id} />
                <input type="hidden" name="back" value={voltarPara} />
                <button type="submit" className="btn-ac-soft">
                  Reenviar
                </button>
              </form>
            )}
          </span>
        )
      },
    },
  ]

  const acoesDaLinha = (a: AlunoDaLista): AcaoDeLinha[] => {
    const itens: AcaoDeLinha[] = [{ rotulo: 'Ver ficha', href: `/admin/alunos/${a.id}` }]
    if (a.acesso === 'sem_convite')
      itens.push({ rotulo: 'Convidar para o portal', href: `/admin/alunos/${a.id}?painel=convidar` })
    return itens
  }

  return (
    <DataTable
      linhas={alunos}
      colunas={colunas}
      chaveDaLinha={(a) => a.id}
      hrefDaLinha={(a) => `/admin/alunos/${a.id}`}
      rotuloDaLinha={(a) => a.nome}
      acoesDaLinha={acoesDaLinha}
      legenda="Acesso dos alunos ao portal"
      vazio={vazio}
    />
  )
}
