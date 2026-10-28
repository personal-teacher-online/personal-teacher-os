-- F1 — ledger com memória (plano integrado v2; M3-3): valor novo do enum em
-- migration PRÓPRIA. Postgres proíbe USAR um valor de enum na mesma transação
-- que o cria ("unsafe use of new value") — e cada migration roda em transação
-- única (rito §G). O CHECK recriado e as funções que usam 'refund' vêm na
-- migration seguinte (20260718000300).
alter type ledger_reason add value 'refund';
