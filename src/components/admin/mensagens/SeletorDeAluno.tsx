'use client'

// SELETOR DE ALUNO DA TELA MENSAGENS (M3-3a). Aluno não cabe em chips (são
// dezenas), então é o Select do kit dentro de um formulário GET de verdade —
// sem JS ele ainda filtra (o Radix planta um `<select>` escondido com o
// `name`, e o resto da URL viaja nos campos ocultos). Com JS, o envio monta o
// endereço pela gramática da tela, para a URL sair limpa e voltar à página 1.

import { useRouter } from 'next/navigation'
import { useId, useState } from 'react'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/kit/select'
import type { AlunoDoSeletor } from '@/data/admin/mensagens'
import { enderecoDasMensagens, type FiltrosDasMensagens } from '@/data/admin/mensagens-gramatica'

/** Sentinela do "todos": o Select do kit (Radix) proíbe item de valor vazio. */
const TODOS = 'todos'

export function SeletorDeAluno({
  alunos,
  filtros,
}: {
  alunos: AlunoDoSeletor[]
  filtros: FiltrosDasMensagens
}) {
  const router = useRouter()
  const id = useId()
  const [aluno, setAluno] = useState(filtros.aluno ?? TODOS)

  return (
    <form
      method="get"
      action="/admin/avisos"
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        router.push(enderecoDasMensagens(filtros, { aluno: aluno === TODOS ? null : aluno }))
      }}
    >
      {filtros.aba !== 'todos' && <input type="hidden" name="st" value={filtros.aba} />}
      {filtros.periodo !== 'tudo' && <input type="hidden" name="p" value={filtros.periodo} />}
      <label htmlFor={id} className="text-sm font-semibold text-ink-900">
        Aluno
      </label>
      <Select name="aluno" value={aluno} onValueChange={setAluno}>
        <SelectTrigger id={id} className="min-w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TODOS}>Todos os alunos</SelectItem>
          {alunos.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.nome}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <button type="submit" className="btn-ac-soft">
        Filtrar
      </button>
    </form>
  )
}
