-- Integração Google Agenda por professora (ADR-017, 14/07/2026) — OAuth da
-- conta PESSOAL de cada professora (atuais e futuras). Decisão do mantenedor:
-- "o app manda, o Google informa" — aulas e janelas são ESCRITAS na agenda
-- dela; os afazeres dela são LIDOS como "ocupado" (grades + checagem ao
-- publicar janela). Edição feita dentro do Google NUNCA move aula/janela:
-- o sync recoloca (as regras continuam TODAS no banco — Lei 3 intacta).
--
-- Aqui vive SÓ a credencial e o bookkeeping de sync. O refresh token entra
-- SEMPRE cifrado (AES-256-GCM; a chave existe apenas em env no servidor —
-- GOOGLE_TOKEN_KEY): o banco, os backups e o audit_log nunca veem o token
-- em claro.

create table teacher_google_accounts (
  teacher_id uuid primary key references teachers (id) on delete cascade,
  google_email text not null,
  refresh_token_cipher text not null,
  connected_at timestamptz not null default now(),
  last_sync_at timestamptz,
  last_sync_error text
);

comment on table teacher_google_accounts is
  'Conexão OAuth Google Agenda da professora (ADR-017). refresh_token_cipher é '
  'AES-256-GCM cifrado no servidor (GOOGLE_TOKEN_KEY em env) — nunca plaintext. '
  'Escrita só pelo servidor (service_role); a professora conecta/desconecta pela '
  'UI, que passa pelas rotas do app.';

-- Lei 8: conectar/trocar credencial deixa trilha (o diff carrega só o CIPHER).
-- last_sync_* fica fora do gatilho — bookkeeping diário não inunda o audit_log.
create trigger teacher_google_accounts_audit
  after insert or update of google_email, refresh_token_cipher or delete
  on teacher_google_accounts
  for each row execute function public.audit_row_change();

alter table teacher_google_accounts enable row level security;

-- Professora vê o PRÓPRIO status; admin vê o de todas (ficha da professora).
create policy tga_own_or_admin_read on teacher_google_accounts
  for select to authenticated
  using (
    teacher_id = (select public.my_teacher_id())
    or (select public.app_role()) = 'admin'
  );

-- Lição 20260714000600 (default privileges dão escrita ampla em produção):
-- revoke explícito ANTES dos grants cirúrgicos.
revoke all on teacher_google_accounts from anon, authenticated, service_role;

-- Defesa em profundidade: o cipher fica FORA do grant de coluna para
-- authenticated — nem a própria professora lê o blob pelo PostgREST (select('*')
-- dela é recusado; as páginas pedem colunas nomeadas); só o servidor
-- (service_role) usa o cipher. anon recebe o grant TOTAL pela convenção do
-- caso 12 de RLS (select('*') permitido, zero linhas — nenhuma policy o alcança).
grant select on teacher_google_accounts to anon;
grant select (teacher_id, google_email, connected_at, last_sync_at, last_sync_error)
  on teacher_google_accounts to authenticated;
grant select, insert, update, delete on teacher_google_accounts to service_role;

-- O job de sync (service_role) lê o que deve existir na agenda dela; era a
-- ÚNICA tabela do sync sem SELECT para service_role (RLS é bypassada, mas o
-- privilégio de tabela é exigido — mesma lição da 20260715000900).
grant select on reschedule_windows to service_role;
