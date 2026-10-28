-- F0 — fundações (plano integrado v2, 18/07/2026; decisões M4-1 e M11-1):
-- profiles e payers entram no gatilho genérico de auditoria (Lei 8). Ficaram
-- fora da leva original; as obras da F7 (canal contratual, troca de número
-- pelo aluno, gestão do pagador na ficha) dependem desta trilha.
create trigger profiles_audit
  after insert or update or delete on profiles
  for each row execute function public.audit_row_change();

create trigger payers_audit
  after insert or update or delete on payers
  for each row execute function public.audit_row_change();
