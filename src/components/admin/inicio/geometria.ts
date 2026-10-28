// RÉGUA DE RESERVA DE GEOMETRIA DO INÍCIO (revisão nº 5 do Sol, item A3).
//
// PROBLEMA: o esqueleto tinha a forma certa e o TAMANHO solto. Quando os dados
// chegavam, o bloco encolhia ou crescia e a página inteira dava um pulo — o
// oposto do que um esqueleto existe para fazer. Piorava porque cada andar tem
// uma promessa própria (C3): eles trocam em momentos diferentes, então o pulo
// de um empurra o outro.
//
// SOLUÇÃO: um PISO de altura, declarado uma vez e consumido nos DOIS lados (o
// andar real e o esqueleto dele). O esqueleto passa a espelhar a contagem
// típica; o piso garante que o conteúdo real não caia abaixo dela.
//
// A RÉGUA, medida na anatomia dos componentes:
//
// · AGENDA DO DIA — 4 linhas de 64px (`min-h-16` da linha real). Quatro é o dia
//   típico da escola hoje (14 alunos, 2 professoras). Dia com 1 aula sobra ar
//   embaixo: é o preço declarado do piso, e é preferível ao pulo de 192px.
// · PENDÊNCIAS — a altura de UM cartão compacto (208px). Como a grade põe 1, 2
//   ou 3 cartões na MESMA fileira (até `xl`), os casos 1 e 3 medem igual, e o
//   esqueleto de 3 cartões vale para os dois.
//   ⚠️ EXCEÇÃO DECLARADA: com ZERO pendências entra o estado vazio completo
//   (ilustração + frase + CTA, ~350px), que é mais alto que o piso. Reservar
//   350px deixaria 140px de vão no caso comum — que é o caso COM pendência.
//   Fica o crescimento, e ele só acontece quando está tudo em dia.
// · FILEIRA DE CARTÕES GRANDES (banda do mês e andar Negócio) — 272px: padding
//   22 + círculo 80 + número 36 + rótulo 20 + detalhe 40 + tendência 16, mais
//   os `gap-2`. É a altura que o `EsqueletoCartaoKpi` já desenhava; agora ela
//   também é piso do lado real, porque os dois cartões de LISTA esticam a
//   fileira inteira e a fileira não pode encolher abaixo do esqueleto.
//
// Estes valores são CLASSES do Tailwind (não px soltos) para continuarem na
// escala de 4px da casa.

/** piso da lista de aulas de hoje — 4 linhas de 64px */
export const RESERVA_AGENDA = 'min-h-64'

/** piso da fila de pendências — um cartão compacto */
export const RESERVA_PENDENCIAS = 'min-h-52'

/** piso de uma fileira de cartões de KPI grandes */
export const RESERVA_CARTOES = 'min-h-68'

/** quantas linhas o esqueleto da agenda desenha (o dia típico) */
export const LINHAS_TIPICAS_DA_AGENDA = 4

/** quantos cartões o esqueleto de pendências desenha (o teto da fileira) */
export const CARTOES_TIPICOS_DE_PENDENCIA = 3
