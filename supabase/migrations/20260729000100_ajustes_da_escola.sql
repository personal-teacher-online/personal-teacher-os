-- ONDA DA AGENDA · A8 — a política de remarcação POR PROFESSORA vira editável.
--
-- O QUE MUDA NO MUNDO: `teachers.min_booking_lead_hours` (antecedência mínima
-- para MARCAR horário novo com aquela professora) e `teachers.holiday_policy`
-- (o que acontece com as aulas num feriado BR) existem desde a F2/F5 e nunca
-- tiveram porta de edição em lugar nenhum do site — só seed e migration. A tela
-- `/admin/ajustes` abre essa porta, e é por isso que esta migration existe.
--
-- POR QUE UMA RPC, e não um UPDATE em TypeScript (Leis 3 e 8):
--   · os dois campos governam DINHEIRO e HORÁRIO. `min_booking_lead_hours` é
--     lido dentro de `reschedule_class` e de `book_computed_slot` para recusar
--     remarcação e resgate em cima da hora; `holiday_policy` decide, no
--     tratamento de período, se a aula do feriado é CANCELADA COM CRÉDITO (o
--     aluno ganha um crédito de reposição) ou só sinalizada. Quem muda esses
--     números muda a regra que o banco aplica a partir do instante seguinte;
--   · a trilha precisa de ATOR. O gatilho genérico de linha (`teachers_audit`,
--     migration 20260711000500) já registra a escrita, mas quando ela chega por
--     `service_role` o `auth.uid()` é NULL: a linha do `audit_log` diz "alguém
--     do servidor mudou a política da dona", que não responde a pergunta que a
--     auditoria existe para responder. O `log_audit` explícito aqui dentro roda
--     na MESMA transação do UPDATE — falhou o audit (FK do ator, por exemplo),
--     a política não muda. Ficam DUAS linhas para a mesma escrita (a do gatilho,
--     sem ator, e a desta função, com ator): é o mesmo par que
--     `admin_update_student_whatsapp` produz em `profiles`, e é redundância
--     barata contra escrita que chegue por fora desta porta.
--
-- ⚠️ A FRASE "ÚNICA PORTA DE ESCRITA" ERA FALSA ATÉ ESTA VERSÃO
-- (Sol · rodada 1 do A8, grave 1). A migration global de RLS concede
-- `grant select, insert, update, delete on all tables in schema public to
-- authenticated` (20260711000700_rls.sql:291) e a policy `teachers_admin_all`
-- libera DML para quem tem papel admin. Com isso, qualquer sessão de admin
-- fazia, do navegador,
--
--   supabase.from('teachers').update({ min_booking_lead_hours: 10000,
--                                      holiday_policy: 'flag' })
--
-- e passava POR FORA da RPC inteira — sem teto, sem `for update`, sem ação
-- semântica na trilha e sem o diff. A RPC era uma porta bonita ao lado de uma
-- parede que não existia, e a Lei 3 seguia violada. O SELO está no fim deste
-- arquivo.
--
-- A FAIXA É VALIDADA AQUI DENTRO, não na tela (a tela pode mentir — `min`/`max`
-- de `<input type=number>` é sugestão, e a action é um endpoint público):
--   · `min_booking_lead_hours` entre `v_piso` e `v_teto` (declarados uma vez, no
--     topo da função — ver a nota do TETO logo abaixo). O piso 0 é o da coluna
--     (CHECK `>= 0`) e significa "pode marcar até a hora de começar";
--   · `holiday_policy` restrita ao conjunto REAL da coluna
--     (`cancel_credit` | `flag`, CHECK da migration 20260718000700). A coluna é
--     `text` com CHECK, não enum — a lista é repetida aqui para o erro falar uma
--     frase inteira em vez de estourar violação de constraint na cara da dona.
--
-- 📌 O TETO DE 168 HORAS É LIMITE COMERCIAL **RATIFICADO PELO DONO** (29/07/2026,
-- ao fim da sessão da onda da Agenda). Nasceu como número inventado pelo
-- implementador e foi corretamente derrubado como injustificado pelo Sol
-- (rodada 1 do A8, grave 4) antes de virar decisão de verdade. A justificativa
-- ("acima de uma semana o portal não ofereceria horário nenhum") foi derrubada
-- pelo revisor: o horizonte de reserva do portal é de 14 DIAS, então 192h ainda
-- deixaria horários elegíveis entre o 8º e o 14º dia — o teto não é consequência
-- técnica de nada, é uma escolha de negócio que ninguém tomou. Ele fica porque
-- digitar 10000 num campo numérico é acidente comum e a coluna aceitaria calada,
-- mas fica como NÚMERO NOMEADO NUM LUGAR SÓ (`v_teto`, usado na comparação e na
-- frase do erro): mudar a política é trocar uma linha. Quando o dono decidir o
-- número de verdade, ele vira ADR — e o par do TypeScript (`ANTECEDENCIA_MAX`,
-- em `src/data/admin/ajustes-gramatica.ts`) é cobrado contra este pelo teste.
--
-- ATOR OBRIGATÓRIO E ADMIN DE VERDADE (mesma defesa em profundidade do
-- `admin_create_student_profile`): o papel é lido em
-- `auth.users.raw_app_meta_data ->> 'role'` — o `app_metadata` da Lei 4, nunca
-- `user_metadata`, que o próprio usuário edita. Não existe caminho produtivo que
-- chame isto sem `requireAdminId()`, e é por isso que a guarda é barata: ela não
-- muda o fluxo bom, e fecha o que sobraria se a porta mudasse de dono.
--
-- A PROFESSORA NÃO EDITA A PRÓPRIA POLÍTICA, de propósito. `_can_manage_teacher`
-- (F5) autoriza admin OU a própria professora para janela/bloqueio — porque
-- aquilo é a agenda DELA. Antecedência mínima e política de feriado são regra
-- comercial da ESCOLA aplicada por professora: quem responde por elas é a dona.
-- Se um dia o painel da professora precisar disso, é decisão de produto e ganha
-- porta própria, não um `grant` a mais nesta.
--
-- LOCK: `select … for update` na linha de `teachers`, e só nela. A tabela está
-- FORA da família da ordem canônica global de locks (migration 20260727000700 —
-- contracts → class_instances → reschedule_windows → recurring_slots →
-- advisory): nenhuma função daquela família trava `teachers` (todas a leem com
-- `select` simples), então esta transação não pode fechar ciclo com elas. O lock
-- existe para o par LER-e-ESCREVER ser atômico: sem ele, dois envios
-- simultâneos poderiam gravar por cima um do outro e auditar um "de" que nunca
-- existiu.
--
-- NO-OP NÃO ESCREVE E NÃO AUDITA: reenviar o formulário sem mudar nada (o F5 da
-- dona, o duplo toque no celular) não gera linha de trilha nem dispara o gatilho
-- da tabela. A trilha responde "o que mudou, quando e por quem" — evento sem
-- mudança é ruído que esconde a mudança de verdade. A tela devolve o mesmo
-- sucesso: o estado final É o que ela pediu.

create or replace function public.admin_set_teacher_policy(
  p_teacher uuid,
  p_lead_hours int,
  p_holiday_policy text,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- A FAIXA, nomeada e num lugar só (ver a nota do TETO no cabeçalho).
  v_piso constant int := 0;
  v_teto constant int := 168;
  v_old_lead int;
  v_old_policy text;
  v_policy text;
begin
  if p_actor is null then
    raise exception 'ator obrigatório para mudar a política de uma professora';
  end if;
  if not exists (
    select 1 from auth.users u
     where u.id = p_actor
       and u.raw_app_meta_data ->> 'role' = 'admin'
  ) then
    raise exception 'a política da professora é decisão da admin';
  end if;
  if p_teacher is null then
    raise exception 'professora não informada';
  end if;

  -- Faixa DENTRO do banco (ver o cabeçalho): a tela é antecipação, não regra.
  if p_lead_hours is null then
    raise exception 'informe a antecedência mínima em horas';
  end if;
  if p_lead_hours < v_piso or p_lead_hours > v_teto then
    raise exception 'antecedência mínima fora da faixa: use de % a % horas', v_piso, v_teto;
  end if;

  v_policy := nullif(btrim(coalesce(p_holiday_policy, '')), '');
  if v_policy is null or v_policy not in ('cancel_credit', 'flag') then
    raise exception 'política de feriado inválida: use cancel_credit ou flag';
  end if;

  select t.min_booking_lead_hours, t.holiday_policy
    into v_old_lead, v_old_policy
    from teachers t
   where t.id = p_teacher
   for update;
  if not found then
    raise exception 'professora não encontrada';
  end if;

  -- Sem mudança, sem escrita e sem trilha (ver o cabeçalho).
  if v_old_lead = p_lead_hours and v_old_policy = v_policy then
    return;
  end if;

  update teachers
     set min_booking_lead_hours = p_lead_hours,
         holiday_policy = v_policy
   where id = p_teacher;

  perform public.log_audit(
    p_actor, 'set_teacher_policy', 'teachers', p_teacher::text,
    jsonb_build_object(
      'old', jsonb_build_object('min_booking_lead_hours', v_old_lead,
                                'holiday_policy', v_old_policy),
      'new', jsonb_build_object('min_booking_lead_hours', p_lead_hours,
                                'holiday_policy', v_policy)));
end;
$$;

comment on function public.admin_set_teacher_policy(uuid, int, text, uuid) is
  'Onda da Agenda · A8: única porta de escrita de teachers.min_booking_lead_hours '
  'e teachers.holiday_policy (selada por privilégio de COLUNA nesta mesma '
  'migration). Faixa validada no banco (v_piso..v_teto; cancel_credit|flag), '
  'ator obrigatório e admin de verdade (app_metadata), audit na mesma transação.';

-- Porta de SERVIDOR (o mesmo desenho de `admin_update_student_whatsapp`): dar
-- `authenticated` aqui deixaria qualquer conta logada — inclusive a de um aluno
-- — mudar a antecedência mínima de qualquer professora. `security definer` sem
-- revoke é escada de privilégio, não conveniência.
revoke execute on function public.admin_set_teacher_policy(uuid, int, text, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_set_teacher_policy(uuid, int, text, uuid)
  to service_role;

-- ===========================================================================
-- O SELO: as duas colunas saem do alcance de `authenticated`
-- (Sol · rodada 1 do A8, grave 1 — sem isto a RPC acima é decorativa)
-- ===========================================================================
--
-- A DECISÃO, NOMEADA: **privilégio de COLUNA**, não trigger.
--
-- A alternativa era um `before update` que recusasse a mudança destas duas
-- colunas fora da RPC (com um GUC de transação como salvo-conduto). Ela foi
-- REJEITADA por três motivos, nesta ordem:
--   1. o gatilho pega TODO MUNDO, inclusive o `postgres` das migrations, dos
--      seeds e das fixtures de teste — que hoje escrevem estas colunas direto
--      (`tests/f2-acoes-aula.test.ts` faz `update teachers set
--      min_booking_lead_hours = 100` para montar o cenário). Ou o gatilho abre
--      exceção por papel (e vira o buraco que ele existe para fechar), ou
--      quebra a suíte e o `db reset`;
--   2. o salvo-conduto por GUC é um segundo mecanismo para manter em dia, e é
--      exatamente o tipo de esperteza que ninguém lembra ao escrever a próxima
--      função;
--   3. o buraco relatado é do papel `authenticated` (o navegador da dona, via
--      PostgREST). Fechar ESSE papel é cirurgia; fechar todos é amputação.
--
-- POR QUE `revoke` + `grant` COLUNA A COLUNA, e não `revoke update (col)`:
-- no Postgres o privilégio de tabela (`relacl`) e o de coluna (`attacl`) são
-- guardados em lugares diferentes. Como o grant global de 20260711000700 é de
-- TABELA, um `revoke update (min_booking_lead_hours) on teachers` não revoga
-- nada — sai um WARNING "no privileges could be revoked for column" e o papel
-- continua podendo escrever a coluna. O caminho que funciona é derrubar o
-- privilégio de tabela e reconceder, uma a uma, as colunas legítimas.
--
-- CONSEQUÊNCIA QUE FICA ESCRITA (é o preço desta escolha): coluna NOVA em
-- `teachers` nasce SEM update para `authenticated`. Isso é seguro por padrão,
-- mas é surpresa garantida para quem adicionar uma coluna e vir o formulário da
-- professora falhar com "permission denied". O aviso está aqui, e o teste do A8
-- compara a lista concedida com as colunas reais da tabela: coluna nova sem
-- decisão explícita = teste VERMELHO, com o nome da coluna no diff.
--
-- O QUE CONTINUA FUNCIONANDO, e é cobrado por teste: `updateTeacherAction`
-- (src/app/admin/professoras/actions.ts) escreve `display_name`, `iana_tz`,
-- `hourly_rate_cents`, `payment_terms`, `cpf` e `contract_kind` pela SESSÃO da
-- dona; `set_teacher_archived` mexe em `archived_at`. Todas estão na lista.
--
-- Os demais papéis não precisam de nada: `anon` nunca teve UPDATE aqui,
-- `service_role` também não (ele fala com estas colunas pela RPC, que é
-- `security definer` e roda como dona da função), e o `postgres` das migrations
-- e dos testes é dono da tabela.
revoke update on public.teachers from authenticated, anon;

-- Todas as colunas de `teachers` MENOS as duas seladas. A lista é explícita de
-- propósito: `grant update on all columns` não existe em SQL, e escrever as
-- colunas uma a uma é o que torna a omissão visível na revisão.
grant update (
  id,
  profile_id,
  hourly_rate_cents,
  payment_terms,
  is_owner,
  display_name,
  iana_tz,
  archived_at,
  cpf,
  contract_kind,
  fallback_meet_url
) on public.teachers to authenticated;

comment on column public.teachers.min_booking_lead_hours is
  'Antecedência mínima (horas) para marcar/remarcar com esta professora. '
  'ESCRITA SELADA: authenticated não tem UPDATE nesta coluna — a única porta é '
  'public.admin_set_teacher_policy (A8, migration 20260729000100).';

comment on column public.teachers.holiday_policy is
  'O que fazer com as aulas num feriado BR (cancel_credit | flag). '
  'ESCRITA SELADA: authenticated não tem UPDATE nesta coluna — a única porta é '
  'public.admin_set_teacher_policy (A8, migration 20260729000100).';
