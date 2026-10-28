import { redirect } from 'next/navigation'

// O wizard virou PAINEL LATERAL sobre a lista (?novo=1 — padrão TutorBird,
// S2-14). Esta rota só preserva links antigos, repassando os params.
export default async function NovoAlunoPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string; aluno?: string; msg?: string; n?: string }>
}) {
  const sp = await searchParams
  const q = new URLSearchParams({ novo: '1' })
  for (const k of ['s', 'aluno', 'msg', 'n'] as const) {
    if (sp[k]) q.set(k, sp[k]!)
  }
  redirect(`/admin/alunos?${q.toString()}`)
}
