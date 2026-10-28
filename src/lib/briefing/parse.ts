// M0c — FormData do briefing → payload das RPCs. ÚNICO montador do jsonb: o
// portal (etapa a etapa) e a retaguarda da dona (tudo de uma vez) passam por
// aqui, para que a mesma tela produza a mesma resposta nos dois caminhos.
// Só inclui seção que tem conteúdo — validação REAL é do banco no envio (Lei 3).
//
// Briefing v2 (28/07/2026): a montagem ramifica por VERSÃO DA LINHA e, no v2,
// por `students.student_type`. As chaves de cada versão são as do dicionário em
// src/lib/briefing/schema.ts.
import { TOPICOS_PROFISSIONAIS_CAMPOS, type TipoAluno, type VersaoBriefing } from './schema'

export interface OpcoesDeParse {
  /** Versão do questionário SOB A QUAL a linha nasceu (briefings.schema_version). */
  versao: VersaoBriefing
  /** Ramo do aluno (students.student_type) — só muda a etapa 2 do v2. */
  tipo: TipoAluno
}

export function parseBriefingForm(
  formData: FormData,
  opcoes: OpcoesDeParse = { versao: 1, tipo: 'adult' },
): {
  answers: Record<string, unknown>
  kolb: Record<string, string> | null
} {
  const txt = (name: string) => String(formData.get(name) ?? '').trim()
  const lista = (name: string) => formData.getAll(name).map(String).filter(Boolean)
  const answers: Record<string, unknown> = {}

  // ---------------------------------------------------------------- hobbies
  // Idêntico nas duas versões (a etapa 3 manteve a grade de 18 + "Outro").
  const hobbies = formData.getAll('hobbies').map(String)
  const outroHobby = txt('hobby_outro')
  if (outroHobby) hobbies.push(`Outro: ${outroHobby}`)

  if (opcoes.versao >= 2) {
    const historia = {
      cidade_vida: txt('cidade_vida'),
      facil: txt('facil'),
      dificil: txt('dificil'),
      contato: lista('contato'),
      experiencia_marcante: txt('experiencia_marcante'),
    }
    if (historia.contato.length > 0 || Object.values(historia).some((v) => typeof v === 'string' && v))
      answers.historia = historia

    if (opcoes.tipo === 'child') {
      const objetivos = {
        para_que_ingles: lista('para_que_ingles'),
        temas_escola: txt('temas_escola'),
        favoritos_midia: txt('favoritos_midia'),
        quem_acompanha: txt('quem_acompanha'),
        temperamento: txt('temperamento'),
      }
      if (objetivos.para_que_ingles.length > 0 || Object.values(objetivos).some((v) => typeof v === 'string' && v))
        answers.objetivos = objetivos
    } else {
      // Os 6 campos curtos entram como LISTA (é assim que o banco conta o mínimo
      // de 3): campo em branco no meio não vira item vazio, some.
      const topicos: string[] = []
      for (let i = 1; i <= TOPICOS_PROFISSIONAIS_CAMPOS; i++) {
        const t = txt(`topico_${i}`)
        if (t) topicos.push(t)
      }
      const objetivos = {
        finalidades: lista('finalidades'),
        finalidade_principal: txt('finalidade_principal'),
        topicos_profissionais: topicos,
        alvo_6_meses: txt('alvo_6_meses'),
        onde_trava: lista('onde_trava'),
        correcao_preferida: txt('correcao_preferida'),
        tempo_diario: txt('tempo_diario'),
        viagem: txt('viagem'),
        intercambio: txt('intercambio'),
      }
      const temAlgo =
        objetivos.finalidades.length > 0 ||
        objetivos.topicos_profissionais.length > 0 ||
        objetivos.onde_trava.length > 0 ||
        Object.values(objetivos).some((v) => typeof v === 'string' && v)
      if (temAlgo) answers.objetivos = objetivos
    }

    const interesses = {
      hobbies,
      leitura: txt('leitura'),
      leitura_detalhe: txt('leitura_detalhe'),
      filmes_series: txt('filmes_series'),
      filmes_series_detalhe: txt('filmes_series_detalhe'),
      musicas: txt('musicas'),
      musicas_detalhe: txt('musicas_detalhe'),
    }
    if (hobbies.length > 0 || Object.values(interesses).some((v) => typeof v === 'string' && v))
      answers.interesses = interesses
  } else {
    const historia = {
      cidade_vida: txt('cidade_vida'),
      facil_dificil: txt('facil_dificil'),
      contato: txt('contato'),
    }
    if (Object.values(historia).some(Boolean)) answers.historia = historia

    const objetivos = {
      finalidades: txt('finalidades'),
      topicos_profissionais: txt('topicos_profissionais'),
      viagem: txt('viagem'),
      intercambio: txt('intercambio'),
    }
    if (Object.values(objetivos).some(Boolean)) answers.objetivos = objetivos

    const interesses = {
      hobbies,
      leitura: txt('leitura'),
      filmes_series: txt('filmes_series'),
      musicas: txt('musicas'),
    }
    if (hobbies.length > 0 || interesses.leitura || interesses.filmes_series || interesses.musicas)
      answers.interesses = interesses
  }

  // ------------------------------------------- rotina (igual nas 2 versões)
  const blocos: Record<string, string[]> = {}
  for (const v of formData.getAll('blocos').map(String)) {
    const [dia, bloco] = v.split('|')
    if (dia && bloco) blocos[dia] = [...(blocos[dia] ?? []), bloco]
  }
  const imersao = txt('imersao')
  const imersaoOutra = txt('imersao_outra')
  if (Object.keys(blocos).length > 0 || imersao)
    answers.rotina = {
      blocos,
      imersao: imersao === 'outra' && imersaoOutra ? `Outra: ${imersaoOutra}` : imersao,
    }

  // ------------------------------------------------------ etapa 6 (fechar)
  const obs = txt('obs')
  const apoio = opcoes.versao >= 2 ? txt('apoio') : ''
  if (obs || apoio) answers.livre = opcoes.versao >= 2 ? { obs, apoio } : { obs }

  const kolb: Record<string, string> = {}
  for (let i = 1; i <= 12; i++) {
    const v = txt(`q${i}`)
    if (v) kolb[`q${i}`] = v
  }
  return { answers, kolb: Object.keys(kolb).length ? kolb : null }
}
