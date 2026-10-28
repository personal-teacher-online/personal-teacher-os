# ADR-039 — Anonimização de nomes em migrations já aplicadas

**Data:** 27/10/2026 · **Status:** aceita (decisão do dono de 14/10/2026, alcance
ampliado em 27/10/2026 na issue #50) · **Exceção explícita à Lei 7**

## Contexto

O repositório vai nascer público (`docs/plano-repositorio-publico-2026-10.md`,
passo 1b). Comentários, `comment on` e mensagens de texto de migrations já
aplicadas citam pelo nome a dona, a professora, o mantenedor e alunos reais do
seed. A Lei 7 proíbe editar migration aplicada; sem editar, os nomes ficam no
público e o scanner de dado real (passo 1c) não fica verde.

## Decisão

1. Em QUALQUER migration já aplicada, só pode mudar **literal de nome**
   (comentário, `comment on`, mensagem de `raise`, texto de exemplo), trocado pelo
   mesmo mapa da anonimização: equipe vira papel ("dona", "professora",
   "mantenedor"), aluno real vira nome fictício fixo. Nenhuma condição, coluna ou
   fluxo muda; os literais que são dado ou texto de erro estão nos itens 2 e 3.
   A tabela abaixo lista arquivo, linha (no arquivo novo), de (mascarado) e para.
2. Dois literais NÃO são comentário e mudam o que o banco grava ou procura, e por
   isso andam juntos: `20260712000400` grava `'Renata'` como
   `display_name` da professora não-dona, e o backfill da `20260713000100` procura
   `ilike 'renata%'`. Aqui vai um primeiro nome fictício, não o papel: o
   `display_name` entra nas mensagens como "Teacher {nome}", e "Teacher Professora"
   não serve. Em produção as duas já rodaram (nada muda lá);
   no `db reset` local e no CI a tabela está vazia nesse ponto e o seed grava o
   mesmo nome. O teste `tests/seed-sanidade.test.ts` prende o casamento.
3. A mensagem do `admin_fill_briefing` (`20260720000100`, linha 264) passa a dizer
   "fale com o mantenedor" (papel, sem nome): quem vê é a admin, então
   "atendimento", como nas irmãs que o aluno vê, mandaria a dona falar com ela mesma. A função não foi
   recriada por migration posterior: **produção continua com o texto antigo** até
   ela ser recriada por outra razão. Não há migration nova só para isso (decisão do
   dono, 27/10/2026).
4. Exemplos de handle em `20260801000100` (comentário) trocam o nome por `escola`,
   mesmo significado.

## Consequência

- O conteúdo (e o checksum) dessas migrations passa a diferir do que produção
  aplicou. Nenhuma ferramenta acusa: o histórico de migrations do Supabase é por
  versão, não por conteúdo, e por isso produção também não reaplica nada. É aceito e
  está anotado no `CLAUDE.md`, "Armadilhas da bancada"; a tabela abaixo é o registro.
- O que é marca fica: "Teacher Vicky" e, onde é a persona pública da marca, "Vicky" sozinho (exceções nominais do scanner; decisão do dono de 28/10/2026, issue #50).
- Nova exceção à Lei 7 exige novo ADR; este não autoriza mudança de lógica.

## Linhas alteradas

| Arquivo | Linha | De (mascarado) | Para |
|---|---|---|---|
| `20260711000200_core.sql` | 109 | `…ot (caso N******+Y***).';…` | `…ot (caso Natália+Yago).';…` |
| `20260711000200_core.sql` | 124 | `…e_cents is 'S******** é paga por…` | `…e_cents is 'A professora é paga por…` |
| `20260711000300_makeup.sql` | 8 | `…O (casal N******+Y*** compartilha…` | `…O (casal Natália+Yago compartilha…` |
| `20260711000400_mentorship.sql` | 83 | `…centuais da V******* entram por…` | `…centuais da dona entram por…` |
| `20260711000400_mentorship.sql` | 110 | `…inidas pela V******* (NÃO passa…` | `…inidas pela dona (NÃO passa…` |
| `20260712000200_fase2_cancel_matrix.sql` | 85 | `…egistro — a V*******…` | `…egistro — a dona…` |
| `20260712000400_fase2_views_rls_grants.sql` | 15 | `…icky' else 'S********' end…` | `…icky' else 'Renata' end…` |
| `20260713000100_fase3_teacher_tz.sql` | 18 | `…2/07/2026): S******** opera de Sã…` | `…2/07/2026): A professora opera de Sã…` |
| `20260713000100_fase3_teacher_tz.sql` | 19 | `…-- V**** permanece n…` | `…-- A dona permanece n…` |
| `20260713000100_fase3_teacher_tz.sql` | 21 | `…de deixar a S******** 1h errada…` | `…de deixar a professora 1h errada…` |
| `20260713000100_fase3_teacher_tz.sql` | 28 | `…name ilike 's********%';…` | `…name ilike 'renata%';…` |
| `20260713000100_fase3_teacher_tz.sql` | 31 | `…do 1 linha (S********), afetadas…` | `…do 1 linha (a professora), afetadas…` |
| `20260713000300_fase3_teacher_windows_rls.sql` | 32 | `…ica; para a V**** = business_…` | `…ica; para a dona = business_…` |
| `20260713000300_fase3_teacher_windows_rls.sql` | 33 | `…or — para a S********/SP, o corre…` | `…or — para a professora/SP, o corre…` |
| `20260713000400_fase3_contract_pauses.sql` | 1 | `…(decisão do L******* no gate M0,…` | `…(decisão do mantenedor no gate M0,…` |
| `20260713000500_fase3_teacher_agenda_view.sql` | 11 | `…--      (a V**** é admin vin…` | `…--      (a dona é admin vin…` |
| `20260714000400_nucleo45_mentorship_refund.sql` | 3 | `…C1/C2/C4 do L*******…` | `…C1/C2/C4 do mantenedor…` |
| `20260715000100_fase5_sync_course_progress.sql` | 8 | `…essão que a V******* vai querer…` | `…essão que a dona vai querer…` |
| `20260715000300_fase4_progress_reports.sql` | 3 | `…-- a V******* revisa/edi…` | `…-- a dona revisa/edi…` |
| `20260715000300_fase4_progress_reports.sql` | 11 | `…WhatsApp da V*******); o artefa…` | `…WhatsApp da dona); o artefa…` |
| `20260715000600_mentorship_eligibility_notices.sql` | 10 | `…endência da V*******).…` | `…endência da dona).…` |
| `20260715001000_no_adiantar_remarcacao.sql` | 1 | `…(decisão do L*******, 14/07/2026…` | `…(decisão do mantenedor, 14/07/2026…` |
| `20260715001100_teacher_google_accounts.sql` | 2 | `…Decisão do L*******:…` | `…Decisão do mantenedor:…` |
| `20260715001200_teacher_lifecycle.sql` | 1 | `…— pedido do L******* após…` | `…— pedido do mantenedor após…` |
| `20260718000700_f5_disponibilidade.sql` | 107 | `…política da V****); flag = só…` | `…política da dona); flag = só…` |
| `20260718001200_f10_mentoria.sql` | 3 | `…vazia até a V**** definir os…` | `…vazia até a dona definir os…` |
| `20260718001200_f10_mentoria.sql` | 23 | `…VAZIA até a V**** definir '…` | `…VAZIA até a dona definir '…` |
| `20260719000100_leva1_regra_cancelamento.sql` | 2 | `…ficada pelo L******* em 18/07/20…` | `…ficada pelo mantenedor em 18/07/20…` |
| `20260720000100_briefing.sql` | 1 | `…rama (OK do L*******, 19/07/2026…` | `…rama (OK do mantenedor, 19/07/2026…` |
| `20260720000100_briefing.sql` | 264 | `…a corrigir, fale com o L******* (regra de…` | `…a corrigir, fale com o mantenedor (regra de…` |
| `20260720000200_curriculum_tracks.sql` | 1 | `…rama (OK do L*******, 19/07/2026…` | `…rama (OK do mantenedor, 19/07/2026…` |
| `20260720000300_study_plans_e_apontamento.sql` | 1 | `…decisões do L*******, madrugada…` | `…decisões do mantenedor, madrugada…` |
| `20260720000300_study_plans_e_apontamento.sql` | 7 | `…rmado com o L******* (desenho or…` | `…rmado com o mantenedor (desenho or…` |
| `20260720000300_study_plans_e_apontamento.sql` | 413 | `…g (botão da V**** na ficha) —…` | `…g (botão da dona na ficha) —…` |
| `20260720000400_fabrica_conteudo.sql` | 3 | `…-- V******* no painel…` | `…-- dona no painel…` |
| `20260721000100_fabrica_slides.sql` | 1 | `…rovado pelo L*******) — as…` | `…rovado pelo mantenedor) — as…` |
| `20260722000100_biblioteca_de_imagens.sql` | 7 | `…-- V******* gera, comp…` | `…-- dona gera, comp…` |
| `20260726000100_fundacoes_de_dados.sql` | 588 | `…Que telas a V******* realmente…` | `…Que telas a dona realmente…` |
| `20260727000200_campos_do_aluno.sql` | 1 | `…) — o que a V**** pede na adm…` | `…) — o que a dona pede na adm…` |
| `20260727000500_correcoes_revisao_8.sql` | 153 | `…* dedo pela V**** junto com o…` | `…* dedo pela dona junto com o…` |
| `20260727000600_sobras_c7.sql` | 14 | `…chega na V**** como erro c…` | `…chega na dona como erro c…` |
| `20260727000700_ordem_global_de_locks.sql` | 58 | `…da V**** no meio de…` | `…da dona no meio de…` |
| `20260727000800_fronteiras_finais.sql` | 405 | `…é ELA que a V**** precisa ler…` | `…é ELA que a dona precisa ler…` |
| `20260727000900_residuais_finais.sql` | 534 | `…é ELA que a V**** precisa ler…` | `…é ELA que a dona precisa ler…` |
| `20260727001000_default_seguro_e_posse.sql` | 534 | `…é ELA que a V**** precisa ler…` | `…é ELA que a dona precisa ler…` |
| `20260727001100_admin_create_contract.sql` | 138 | `…o casal do Y*** com o Y***" não é…` | `…o casal do Yago com o Yago" não é…` |
| `20260727001200_correcoes_sol_rodada_2.sql` | 267 | `…sagem que a V**** já…` | `…sagem que a dona já…` |
| `20260727001200_correcoes_sol_rodada_2.sql` | 511 | `…o casal do Y*** com o Y***" não é…` | `…o casal do Yago com o Yago" não é…` |
| `20260727001200_correcoes_sol_rodada_2.sql` | 525 | `…de teste da V****. Só o NEGAT…` | `…de teste da dona. Só o NEGAT…` |
| `20260727001400_correcoes_sol_rodada_4.sql` | 95 | `…baixo de "a V**** tenta de no…` | `…baixo de "a dona tenta de no…` |
| `20260727001400_correcoes_sol_rodada_4.sql` | 305 | `…mento, lê "E**** F******" (sem lock)…` | `…mento, lê "Elisa Faria" (sem lock)…` |
| `20260727001400_correcoes_sol_rodada_4.sql` | 307 | `…meia para "E**** Nakamura" e…` | `…meia para "Elisa Nakamura" e…` |
| `20260728000400_briefing_update_reminder.sql` | 5 | `…e manual da V**** na ficha do…` | `…e manual da dona na ficha do…` |
| `20260729000100_ajustes_da_escola.sql` | 19 | `…política da V****", que não r…` | `…política da dona", que não r…` |
| `20260730000100_a6_travas_de_agenda.sql` | 144 | `…na cara da V**** no meio de…` | `…na cara da dona no meio de…` |
| `20260730000100_a6_travas_de_agenda.sql` | 1068 | `…na cara da V**** no meio de…` | `…na cara da dona no meio de…` |
| `20260730000200_a6_aviso_com_escolha.sql` | 395 | `…dona (ou o L*******) achar a au…` | `…dona (ou o mantenedor) achar a au…` |
| `20260801000100_pauta_criadores.sql` | 41 | `…texto, e ' v**** ' — que passaria num "não vazio" — nem colide com 'v****' no…` | `…texto, e ' escola ' — que passaria num "não vazio" — nem colide com 'escola' no…` |
| `20260803000100_content_embeddings.sql` | 14 | `…tema que a V**** descartou).…` | `…tema que a dona descartou).…` |
| `20260803000200_criadores_tier_tipo.sql` | 4 | `…a lista da V**** (pergunta 5…` | `…a lista da dona (pergunta 5…` |
| `20260803000300_content_trends.sql` | 8 | `…bjeto que a V**** decide no r…` | `…bjeto que a dona decide no r…` |
| `20260803000300_content_trends.sql` | 324 | `…válvula da V**** (ADR-033 de…` | `…válvula da dona (ADR-033 de…` |
| `20260803000400_gerar_roteiro_da_trend.sql` | 6 | `…carimbo da V**** →…` | `…carimbo da dona →…` |
| `20260803000400_gerar_roteiro_da_trend.sql` | 32 | `…-- V**** nunca se pe…` | `…-- dona nunca se pe…` |
| `20260803000400_gerar_roteiro_da_trend.sql` | 47 | `…rrida. Se a V**** clicar no r…` | `…rrida. Se a dona clicar no r…` |
| `20260803000400_gerar_roteiro_da_trend.sql` | 109 | `…T: avisar a V**** para revisa…` | `…T: avisar a dona para revisa…` |
| `20260803000400_gerar_roteiro_da_trend.sql` | 218 | `…escolha da V**** é a aprovaç…` | `…escolha da dona é a aprovaç…` |
| `20260804000100_digest_do_lote.sql` | 7 | `…-- V**** provoca ao…` | `…-- dona provoca ao…` |
| `20260804000100_digest_do_lote.sql` | 18 | `…ez; o que a V**** vai abrir é…` | `…ez; o que a dona vai abrir é…` |
| `20260804000100_digest_do_lote.sql` | 149 | `…ostra: a da V**** vence a do…` | `…ostra: a da dona vence a do…` |
| `20260804000100_digest_do_lote.sql` | 169 | `…-- V**** a ignorar o…` | `…-- dona a ignorar o…` |
| `20260804000100_digest_do_lote.sql` | 206 | `…úmero que a V**** nunca leu.…` | `…úmero que a dona nunca leu.…` |
| `20260901000100_m2_professora_cancela_e_remarca.sql` | 15 | `…her_id() (a V****, admin vinc…` | `…her_id() (a dona, admin vinc…` |
| `20260901000100_m2_professora_cancela_e_remarca.sql` | 212 | `…quem fez (a V****, quando age…` | `…quem fez (a dona, quando age…` |
