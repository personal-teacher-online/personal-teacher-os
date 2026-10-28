-- CORREÇÃO 28/07/2026 (regra do dono) — o WhatsApp de avisos é canal de
-- CONTRATO, não opt-in do portal.
--
-- ⚠️ ARQUIVO REESCRITO EM PLACE nas rodadas do Sol (28/07, achados 4 e 5;
-- rodada 3 acrescentou `admin_update_student_whatsapp` — ver o bloco no fim) e
-- de novo no A4 (29/07: as duas guardas de ator do `admin_create_student_profile`,
-- no fim do arquivo), e isso NÃO fere a Lei 7: imutável é migration APLICADA em
-- ambiente compartilhado, e esta nunca saiu da bancada — produção parou na 94ª
-- (conferido em `supabase_migrations.schema_migrations`, lição do §S).
--
-- O contrato externo que o aluno assina já autoriza os avisos por WhatsApp
-- desde o início. Consequências no sistema:
--   · o número nasce com a professora, no CONVITE (obrigatório no formulário e
--     no PROVISIONAMENTO — `provisionStudent` cria o perfil pela RPC
--     `admin_create_student_profile`, que exige o número) — quem tem acesso ao
--     portal tem número;
--     ⚠️ HONESTIDADE SOBRE ONDE ESSA REGRA MORA (correção do portão de deploy,
--     29/07): "aluno com acesso tem número" NÃO é invariante do BANCO — o CHECK
--     abaixo aceita `NULL` de propósito (o admin limpa pela ficha) e não existe
--     gatilho que o proíba. Quem sustenta a regra hoje é o TypeScript: as portas
--     de provisionamento (motor + actions) recusam aluno sem número. O
--     endurecimento no banco (gatilho ou CHECK condicional ao vínculo) está
--     roteado para o A6 — até lá, chamar isto de "invariante estrutural" é
--     mentira de comentário;
--   · no portal o aluno TROCA o número, e só. Apagar deixaria a escola sem o
--     canal que o contrato promete, EM SILÊNCIO: os lembretes cairiam para
--     e-mail (`lib/outbox/dispatch.ts` falha com "sem número de WhatsApp no
--     cadastro") e ninguém saberia até um lembrete não chegar.
--
-- Lei 3: a regra passa a viver no banco. O campo `required` em /portal/perfil é
-- só a antecipação desta recusa para a UX — nunca a regra.
--
-- ESCOPO DELIBERADO: o admin continua podendo limpar o número pela ficha
-- (`updateStudentWhatsappAction`) — ele é dono do dado, precisa poder corrigir
-- número errado, e existem alunos legados sem número nenhum. Rodada 3 do Sol:
-- essa porta deixou de ser um UPDATE direto em TS e virou a RPC
-- `admin_update_student_whatsapp` (fim do arquivo) — a permissão de limpar
-- fica, mas agora com update+audit na MESMA transação.
--
-- O marcador de erro é uma CHAVE (`whatsapp-obrigatorio`), não uma frase: quem
-- fala português com o aluno é a action, como já acontece com
-- `politica-desatualizada` no aceite. Frase de banco vazando para o portal é
-- jargão — a onda do Portal matou esse padrão.
--
-- Rodada 2 do Sol (achado 4): a régua E.164 vira CONSTRAINT na coluna, não só
-- corpo de RPC. A RPC do aluno e a action do admin validam o mesmo formato,
-- mas qualquer escrita futura por outro caminho (service_role, SQL manual,
-- action nova) passava sem régua nenhuma — CHECK é a única forma de a regra
-- valer para todas as portas de uma vez (Lei 3). `NULL` continua permitido de
-- propósito: o admin pode limpar o número pela ficha (decisão aceita).
--
-- ⚠️ RISCO DE DEPLOY: se produção tiver alguma linha de `profiles` com número
-- fora do formato, o `alter table ... add constraint` FALHA e o apply para. A
-- porta do admin valida este formato desde a F7, então a expectativa é ZERO
-- linhas — mas o rito de deploy roda o pré-voo antes do apply:
--
--   select id, whatsapp_e164 from profiles
--    where whatsapp_e164 is not null
--      and whatsapp_e164 !~ '^\+[1-9]\d{9,14}$';
--
-- Linha encontrada = corrigir pela ficha (ou anotar decisão) ANTES do deploy.
--
-- Os dois consertos da rodada do Sol nesta versão:
--   · a regex é a MESMA da action (`^\+[1-9]\d{9,14}$`,
--     src/app/admin/alunos/actions.ts) — E.164 canônico COM '+'. A anterior
--     (`^\+?[0-9]{10,15}$`) aceitava número sem '+' e até '0000000000', que o
--     driver Evolution e o `splitE164` do formulário não sabem ler: as duas
--     portas têm de recusar o mesmo conjunto;
--   · UPDATE sem linha atingida deixou de ser sucesso silencioso. Conta
--     autenticada sem perfil recebia "Número atualizado ✓" e um registro de
--     auditoria de uma escrita que nunca aconteceu — agora é exceção, e o
--     audit só roda depois do update confirmado.

-- A régua estrutural (ver o cabeçalho): E.164 canônico com '+', ou NULL.
alter table profiles add constraint profiles_whatsapp_e164_formato
  check (whatsapp_e164 is null or whatsapp_e164 ~ '^\+[1-9]\d{9,14}$');

create or replace function public.update_my_whatsapp(p_e164 text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_clean text;
begin
  if auth.uid() is null then
    raise exception 'sessão necessária';
  end if;
  v_clean := nullif(btrim(coalesce(p_e164, '')), '');
  -- Correção 28/07: vazio deixa de significar "desligar o canal" e passa a ser
  -- recusa. Antes desta migration, um submit com o campo vazio gravava NULL.
  if v_clean is null then
    raise exception 'whatsapp-obrigatorio';
  end if;
  if v_clean !~ '^\+[1-9]\d{9,14}$' then
    raise exception 'número inválido — use o formato +5565999999999';
  end if;
  update profiles set whatsapp_e164 = v_clean where id = auth.uid();
  if not found then
    raise exception 'perfil não encontrado para esta conta';
  end if;
  perform public.log_audit(auth.uid(), 'update_my_whatsapp', 'profiles', auth.uid()::text,
    jsonb_build_object('whatsapp_e164', v_clean));
end;
$$;

revoke execute on function public.update_my_whatsapp(text) from public, anon;
grant execute on function public.update_my_whatsapp(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Rodada 3 do Sol (achado 1, P1) — a porta do ADMIN também vira RPC.
--
-- O par que existia no app (UPDATE em `profiles` via TS + `audit()` separado)
-- violava as Leis 3 e 8 por construção: o audit era fail-open (engolia a falha
-- e seguia), então existia um mundo em que o número mudava SEM trilha de ator.
-- Update e audit na mesma transação só existem dentro do banco — por isso a
-- função. Quem a chama: `provisionStudent` (reenvio/já-ativo com número novo) e
-- `updateStudentWhatsappAction` (a ficha). O NASCIMENTO do número tem a irmã
-- dela logo abaixo (`admin_create_student_profile`).
--
-- NULL/vazio aqui NÃO é recusa (diferente da RPC do aluno): limpar o número é
-- decisão aceita do admin — e agora a limpeza fica AUDITADA, em vez de muda.
--
-- Correção do portão de deploy (29/07): a frase "o caminho de CRIAÇÃO do perfil
-- não passa por aqui de propósito" que ficava neste bloco CAIU — ela descrevia
-- exatamente o buraco que o `admin_create_student_profile` abaixo veio fechar.
-- ---------------------------------------------------------------------------
create or replace function public.admin_update_student_whatsapp(
  p_profile uuid, p_e164 text, p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_clean text;
begin
  -- Trilha SEM autor era exatamente o defeito que esta RPC veio matar (Sol ·
  -- rodada 4): esta é porta de SERVIDOR, e o servidor sempre sabe quem pediu.
  if p_actor is null then
    raise exception 'ator obrigatório para trocar o WhatsApp de um aluno';
  end if;
  v_clean := nullif(btrim(coalesce(p_e164, '')), '');
  -- A MESMA régua E.164 canônica das outras portas (action e RPC do aluno):
  -- as portas têm de recusar o mesmo conjunto. NULL passa (limpeza deliberada).
  if v_clean is not null and v_clean !~ '^\+[1-9]\d{9,14}$' then
    raise exception 'número inválido — use o formato +5565999999999';
  end if;
  update profiles set whatsapp_e164 = v_clean where id = p_profile;
  -- Sem linha atingida não é sucesso (mesma régua do `if not found` acima):
  -- fingir que gravou reenviaria convite sem canal e auditaria escrita fantasma.
  if not found then
    raise exception 'perfil não encontrado';
  end if;
  perform public.log_audit(p_actor, 'update_student_whatsapp', 'profiles', p_profile::text,
    jsonb_build_object('whatsapp_e164', v_clean));
end;
$$;

-- Porta de ADMIN/SERVIDOR: só o service_role executa. O aluno tem a dele
-- (`update_my_whatsapp`); dar `authenticated` aqui deixaria qualquer conta
-- logada trocar o número de qualquer perfil.
revoke execute on function public.admin_update_student_whatsapp(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_update_student_whatsapp(uuid, text, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- PORTÃO DE DEPLOY, 29/07 (bloqueador 2 das duas revisões) — o NASCIMENTO do
-- número também passa pela porta transacional.
--
-- O que estava errado: o perfil do aluno nascia por um INSERT em TS
-- (`provision.ts`) e a trilha com ator era uma chamada SEPARADA — `audit()`,
-- que ENGOLE a falha e segue. Existia, portanto, um mundo em que usuário,
-- perfil, número e vínculo persistiam, o convite saía, e NINGUÉM registrava
-- quem cadastrou aquele número (Lei 8). O gatilho genérico de linha registra a
-- escrita, mas via `service_role` o ator fica NULL — "alguém do servidor" não
-- responde à pergunta "quem convidou e cadastrou este número".
--
-- Aqui INSERT e auditoria são a MESMA transação: falhou o audit (FK do ator,
-- por exemplo), o perfil não nasce.
--
-- ATOR OBRIGATÓRIO, sem exceção e sem ator sintético: o nascimento do número só
-- acontece pela ficha do admin (`inviteStudentAction`, que tem
-- `requireAdminId()`). O único fluxo público que provisiona — a recuperação de
-- convite de `/convite-expirado` — nunca cria perfil: ele recusa aluno sem
-- perfil e aluno com perfil sem número, justamente para não abrir esta porta.
--
-- PAPEL LITERAL: a função grava `role = 'student'` fixo. Papel vindo de
-- argumento seria escada de privilégio numa porta de servidor (Lei 4); a
-- professora, que não tem número em jogo, continua nascendo pelo INSERT comum.
--
-- DEFESA EM PROFUNDIDADE (A4, 29/07 — achado da verificação do portão): "ator
-- obrigatório" era fraco demais para o que esta trilha promete responder ("quem
-- convidou e cadastrou este número"). Duas frestas, as duas fechadas ABAIXO,
-- dentro do banco, porque a regra é do banco (Lei 3):
--   1. `p_actor = p_profile` PASSAVA. O ator fantasma quebra na FK do
--      `audit_log`, mas o perfil recém-inserido satisfaz essa FK — o cadastro
--      podia sair atribuído ao PRÓPRIO ALUNO, com cara de trilha válida;
--   2. ator sem papel de ADMIN passava. Qualquer uuid de perfil servia.
-- Nenhum caminho produtivo faz isso hoje (só `service_role` executa, e o convite
-- passa por `requireAdminId()`), e é exatamente por isso que a guarda é barata:
-- ela não muda o fluxo bom, e fecha o que sobraria se a porta mudasse de dono.
--
-- ONDE O PAPEL É LIDO: `auth.users.raw_app_meta_data ->> 'role'` — o
-- `app_metadata` da Lei 4, o MESMO campo que o `roleFromUser` do app lê do JWT.
-- Aqui não há JWT (a porta é `service_role`), então a leitura é direta na
-- tabela. Não é `profiles.role`, que o próprio schema chama de "referência
-- operacional": autorização se lê no app_metadata, nunca no espelho — e nunca
-- em `user_metadata`, que o usuário edita.
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_student_profile(
  p_profile uuid, p_full_name text, p_iana_tz text, p_e164 text, p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_clean text;
begin
  if p_actor is null then
    raise exception 'ator obrigatório para cadastrar o WhatsApp de um aluno';
  end if;
  -- Ninguém cadastra o próprio acesso: quem responde pelo cadastro é sempre
  -- outra pessoa (a admin), e uma trilha que aponta para o cadastrado não
  -- responde a pergunta nenhuma.
  if p_actor = p_profile then
    raise exception 'o ator do cadastro não pode ser o próprio aluno';
  end if;
  if not exists (
    select 1 from auth.users u
     where u.id = p_actor
       and u.raw_app_meta_data ->> 'role' = 'admin'
  ) then
    raise exception 'cadastro de aluno é restrito à admin (D10)';
  end if;
  v_clean := nullif(btrim(coalesce(p_e164, '')), '');
  -- No NASCIMENTO o número é OBRIGATÓRIO (diferente da irmã, onde NULL é a
  -- limpeza deliberada do admin): perfil de aluno sem número é exatamente o
  -- estado que a correção do dono proíbe.
  if v_clean is null then
    raise exception 'whatsapp-obrigatorio';
  end if;
  if v_clean !~ '^\+[1-9]\d{9,14}$' then
    raise exception 'número inválido — use o formato +5565999999999';
  end if;
  insert into profiles (id, role, full_name, iana_tz, whatsapp_e164)
  values (p_profile, 'student', p_full_name, p_iana_tz, v_clean);
  perform public.log_audit(p_actor, 'create_student_whatsapp', 'profiles', p_profile::text,
    jsonb_build_object('whatsapp_e164', v_clean, 'iana_tz', p_iana_tz));
end;
$$;

revoke execute on function public.admin_create_student_profile(uuid, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_create_student_profile(uuid, text, text, text, uuid)
  to service_role;
