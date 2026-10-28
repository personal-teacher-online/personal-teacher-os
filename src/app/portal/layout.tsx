// Shell do portal do aluno — "Papel & Tinta": faixa de tinta no topo e papel
// claro para o conteúdo. A moldura em si (marca, seções, barra de polegar,
// aviso de fuso) mora no `PortalShell`; aqui ficam só as peças de página
// inteira e a leitura do fuso cadastrado.
//
// Onda do Portal · P1: entra o `<Toaster>` do kit. É por ele que o recado
// pós-ação aparece.
//
// P4 (2ª revisão): o recado das ações NOVAS também entra aqui, pelo
// `<RecadoDoPortal>` — a moldura lê o cookie de flash e TODA rota do portal
// mostra o desfecho, inclusive as duas telas de gate (ciência e briefing), que
// era exatamente onde ele se perdia quando cada página lia o cookie sozinha.
//
// P5: agora é o ÚNICO caminho. As últimas telas com `?msg=&n=` na URL (resgate,
// mentoria, perfil, ciência, briefing e re-briefing) migraram para o cookie, e
// nenhuma página do portal lê `msg` de query string — a ponte do M3 acabou aqui
// dentro (ela sobrevive no admin, onde as ações daquelas telas ainda a usam).
//
// O `PopupManager` continua porque as telas VELHAS do portal ainda usam
// `<details data-popup>`.
//
// ⚠️ NÃO envolver o `PortalShell` num `<Suspense>` (lição C4 do admin): ele é
// a moldura, e suspender a moldura faz o portal inteiro sumir enquanto uma
// página qualquer espera. As duas consultas da moldura são AGUARDADAS aqui — de
// propósito, para a barra do polegar não trocar de 4 para 5 colunas debaixo do
// dedo (P1 · F5).
//
// AS DUAS PERGUNTAS SAEM JUNTAS (P1 · G5). O fuso cadastrado e "este aluno é do
// Personal Travel?" não dependem um do outro, e mesmo assim eram uma cascata: o
// layout esperava a primeira e só então renderizava o shell, que aí começava a
// segunda. Duas idas ao banco em fila somam duas latências para nada. Agora as
// duas promessas nascem na mesma linha, o `Promise.all` espera pelas duas ao
// mesmo tempo e o shell RECEBE a resposta da mentoria — ele não pergunta mais
// por conta própria.
import { temMentoriaAtiva } from '@/lib/portal/data'
import { createClient } from '@/lib/supabase/server'
import { Toaster } from '@/components/kit/toaster'
import { PopupManager } from '@/components/PopupManager'
import { PortalShell } from '@/components/portal/PortalShell'
import { RecadoDoPortal } from '@/components/portal/RecadoDoPortal'
import { UiBeacon } from '@/components/UiBeacon'

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const [{ data: me }, temMentoria] = await Promise.all([
    supabase.from('students').select('iana_tz').limit(1),
    temMentoriaAtiva(supabase),
  ])
  const tz = me?.[0]?.iana_tz ?? null

  return (
    // `overflow-x-clip`: a mesma tesoura do admin — nada do portal pode criar
    // rolagem horizontal. `pb-24 md:pb-0`: a folga da barra de polegar, que é
    // `fixed` e não empurra o conteúdo.
    <div
      data-surface="paper"
      className="flex min-h-dvh w-full flex-col overflow-x-clip bg-paper-50 pb-24 text-ink-900 [color-scheme:light] md:pb-0"
    >
      <PopupManager />
      <UiBeacon />
      <Toaster />
      {/* O recado é `fixed` (toast e faixa `<noscript>`): a posição na árvore
          não desloca nada — o que importa é ele existir em toda rota. */}
      <RecadoDoPortal />
      <PortalShell tz={tz} temMentoria={temMentoria}>
        {children}
      </PortalShell>
    </div>
  )
}
