// FRASE DO ERRO DE CAMPO (M3-c4 · B3) — a parte PURA da validação inline.
//
// O dono reprovou o balão nativo do navegador ("Preencha este campo", numa
// caixinha cinza que some sozinha e que o leitor de tela não guarda). O padrão
// novo é o do TutorBird: borda vermelha no campo + frase EM BAIXO dele, em
// português da casa. Quem pinta é o `FormValidado` (kit, cliente); quem ESCOLHE
// A FRASE é esta função — pura, sem DOM, testável linha a linha.
//
// A ordem das causas não é decorativa: a frase mais específica ganha.
//   1. frase PRÓPRIA (`setCustomValidity`) — o CityPicker ("Escolha uma cidade
//      da lista."), o DateField ("Escolha uma data a partir de …") e o
//      conflito de horário do wizard já falam por si; nada aqui os cala;
//   2. campo obrigatório VAZIO → a exigência que a tela escreveu ("Informe o
//      valor da aula"), porque só ela sabe o nome do dado;
//   3. formato/tipo/faixa → frases genéricas, mas nossas.
//
// O servidor continua sendo a fonte da verdade (as actions e o banco recusam
// de novo, sempre): isto é ANTECIPAÇÃO de erro, nunca a validação.

export interface SintomaDoCampo {
  /** obrigatório e vazio (`validity.valueMissing`) */
  faltando: boolean
  /** `type="email"`/`url` com forma errada (`validity.typeMismatch`) */
  tipoErrado: boolean
  /** `pattern` não casou (`validity.patternMismatch`) */
  formatoErrado: boolean
  /** min/max/step/tamanho (`rangeUnderflow` e parentes) */
  foraDaFaixa: boolean
  /** frase posta por `setCustomValidity` — `null` quando não há */
  frasePropria: string | null
  /** a frase que a TELA escreveu para este campo (`data-exigencia`) */
  exigencia: string | null
  /** o `title` do campo quando ele é o FORMATO esperado ("dd/mm/aaaa") */
  formato: string | null
  /** `type` do controle — só o e-mail muda a frase */
  tipo: string
}

export function mensagemDoCampo(s: SintomaDoCampo): string {
  const propria = s.frasePropria?.trim()
  if (propria) return propria

  if (s.faltando) return s.exigencia?.trim() || 'Este campo é obrigatório.'

  if (s.tipoErrado) {
    if (s.tipo === 'email') return 'Confira o e-mail: falta o @ ou o domínio.'
    return 'Confira o formato deste campo.'
  }

  if (s.formatoErrado) {
    const formato = s.formato?.trim()
    if (formato) return `Use o formato ${formato}.`
    return s.exigencia?.trim() || 'Confira o formato deste campo.'
  }

  if (s.foraDaFaixa) return 'O valor está fora do que este campo aceita.'

  return s.exigencia?.trim() || 'Confira este campo.'
}
