-- Fase 3 / M0.1 — Fuso próprio da professora (F3-D2; revisita ADR-013 §7).
-- teachers.iana_tz é a FONTE ÚNICA do fuso operacional da professora: painel,
-- caminho teacher das RPCs de janela e todos os e-mails leem DAQUI — nunca de
-- profiles.iana_tz (default de profiles é America/Sao_Paulo; divergência = 1h REAL).

alter table teachers
  add column iana_tz text not null default 'America/Cuiaba';

comment on column teachers.iana_tz is
  'Fonte ÚNICA do fuso operacional da professora (F3-D2). O provisionamento copia '
  'este valor para profiles.iana_tz no vínculo; mudanças aqui devem espelhar lá.';

-- Mesmo endurecimento das demais colunas de zona (ADR-004/ADR-008).
create trigger teachers_valid_tz
  before insert or update of iana_tz on teachers
  for each row execute function public.assert_valid_iana_tz();

-- Backfill (Q1 respondida em 12/07/2026): A professora opera de São Paulo.
-- A dona permanece no default America/Cuiaba (fuso do negócio).
-- Fail-fast (Disciplina 3): em produção existe exatamente 1 professora não-owner;
-- se o match por nome divergir, ABORTA em vez de deixar a professora 1h errada
-- (no-op silencioso seria a classe de erro que a F3-D2 existe para matar).
-- No `db reset` local a tabela está vazia aqui (seed roda depois) → no-op legítimo.
do $$
declare n int;
begin
  update teachers set iana_tz = 'America/Sao_Paulo'
   where display_name ilike 'renata%';
  get diagnostics n = row_count;
  if n <> 1 and exists (select 1 from teachers where not is_owner) then
    raise exception 'Backfill F3-D2/Q1: esperado 1 linha (a professora), afetadas % — display_name divergiu em produção; corrija o match antes de aplicar', n;
  end if;
end $$;

-- Espelho em profiles para professoras JÁ vinculadas (hoje nenhuma; idempotente).
update profiles p set iana_tz = t.iana_tz
  from teachers t
 where t.profile_id = p.id and p.iana_tz is distinct from t.iana_tz;
