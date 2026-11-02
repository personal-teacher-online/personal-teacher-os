-- #118 — a aluna de mentoria continua vendo o encontro que ela reservou.
--
-- A política `mentorship_sessions_open_to_mentees` (20260711000700_rls.sql)
-- só deixa a mentorada ler sessões com status 'open'. Quando a última vaga é
-- reservada, `book_mentorship_session` passa a sessão para 'full'
-- (20260714000400 §M2) e ela SOME justamente para quem tem reserva nela: o
-- portal perdia data, hora e link da sala do encontro já pago.
--
-- Regra (Lei 4, negar por padrão): a aluna lê uma sessão quando ela está
-- aberta (política antiga, intocada) OU quando tem reserva ATIVA nela,
-- qualquer que seja o status da sessão. Políticas permissivas se somam por OR,
-- então esta só ACRESCENTA linhas para quem tem reserva; ninguém perde nada.
--
-- "Reserva dela" é a mesma régua de `mentorship_bookings_student`: reserva do
-- contrato que é dela (`my_contract_ids()`). Reserva cancelada/estornada
-- (`cancelled_at` preenchido) não conta: sessão cancelada tem todas as
-- reservas canceladas (o trigger `mentorship_sessions_cancel_guard` impede
-- cancelar com reserva ativa), então continua invisível como hoje.
--
-- A política lê `mentorship_bookings`, que tem RLS própria; nenhuma política de
-- `mentorship_bookings` lê `mentorship_sessions`, então não há recursão. As
-- reservas das OUTRAS alunas continuam fora: esta política expõe a SESSÃO
-- (data, hora, vagas, link da sala), nunca linha de reserva alheia.
--
-- A subconsulta não é correlacionada: o Postgres a resolve uma vez por consulta
-- (as reservas ativas da aluna), não uma vez por sessão lida.
--
-- Nada destrutivo, nenhuma função nova (nada a revogar do PUBLIC).

create policy mentorship_sessions_booked_by_me on mentorship_sessions
  for select to authenticated
  using (
    id in (
      select b.session_id from mentorship_bookings b
      where b.cancelled_at is null
        and b.contract_id in (select public.my_contract_ids())
    )
  );

comment on policy mentorship_sessions_booked_by_me on mentorship_sessions is
  '#118: a mentorada lê a sessão em que tem reserva ativa (do próprio contrato), qualquer que seja o status — soma-se por OR à mentorship_sessions_open_to_mentees.';
