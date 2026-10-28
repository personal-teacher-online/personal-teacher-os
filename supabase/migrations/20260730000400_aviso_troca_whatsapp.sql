-- Onda da Agenda · LOTE FINAL — A TROCA DE WHATSAPP PELO ALUNO AVISA A
-- PROFESSORA.
--
-- DECISÃO DO DONO (29/07/2026), registrada no goal
-- (`docs/goals/onda-agenda.md`, § "As 4 dívidas do WhatsApp"): «o aluno
-- continua podendo TROCAR o próprio WhatsApp no portal, mas a Teacher passa a
-- ser avisada por e-mail quando isso acontece. Encaixa no outbox de e-mail da
-- Fase 3; não é construção nova.»
--
-- POR QUE ISSO IMPORTA: desde a correção de 28/07 o WhatsApp é canal de
-- CONTRATO — é por ele que a escola avisa das aulas. O aluno troca o número
-- sozinho, no portal, e até aqui ninguém do outro lado ficava sabendo: a
-- professora seguia com o número velho na cabeça (e no celular dela), e a
-- primeira notícia da troca era um recado que não chegou.
--
-- ---------------------------------------------------------------------------
-- POR QUE UMA MIGRATION NOVA, e não a reescrita da 95
-- ---------------------------------------------------------------------------
-- `update_my_whatsapp` é efetiva em `20260728001000_whatsapp_do_contrato.sql`.
-- Aquele arquivo foi reescrito em place várias vezes porque nunca saiu da
-- bancada; ESTE lote não repete o gesto, por decisão do orquestrador: a função
-- é redefinida aqui, por `create or replace`, com a ASSINATURA INTOCADA
-- (`(p_e164 text) returns void`) e o corpo VERBATIM da 95 mais o enqueue no
-- fim. Sem `drop`, sem overload novo, sem ACL nova (a de lá continua valendo,
-- porque a assinatura é a mesma).
--
-- PRÉ-VOO: nenhum. Esta migration não cria tabela, constraint nem toca dado
-- existente — ela troca o corpo de uma função e nada mais.
--
-- ---------------------------------------------------------------------------
-- QUEM RECEBE, E QUANDO NÃO RECEBE
-- ---------------------------------------------------------------------------
--   · UMA linha de E-MAIL por PROFESSORA DISTINTA dos contratos ATIVOS do
--     aluno — individuais e de GRUPO (o aluno de um casal/turma é membro, não
--     dono do contrato, e a professora dele é a mesma). Duas matérias com a
--     mesma professora não viram dois e-mails: o `distinct` é sobre a
--     professora, não sobre o contrato.
--   · Contrato PAUSADO ou ENCERRADO não avisa: a professora de um contrato
--     que não está correndo não precisa do número novo hoje. (Se ele voltar,
--     o número já estará certo no cadastro — é lá que ela o lê.)
--   · Mentoria sem professora (`teacher_id is null`) não tem a quem avisar.
--   · PROFESSORA SEM PERFIL É PULADA, e isto é o OPOSTO da decisão da linha
--     órfã de `_enqueue_class_cancelled` — de propósito. Lá o destinatário é o
--     ALUNO, que pode ganhar login depois, e o despachante resolve o perfil
--     tarde (por `payload.student_id`); a linha órfã é uma pendência legítima
--     que fica visível em Mensagens. Aqui o destinatário é INTERNO e conhecido:
--     uma linha sem `recipient_profile_id` seria pior do que nenhuma, porque a
--     resolução tardia do despachante (`src/lib/outbox/dispatch.ts`) procuraria
--     o perfil pelo `student_id` do payload e mandaria à ALUNA um e-mail
--     interno sobre ela mesma. Professora sem acesso ao sistema se avisa por
--     fora; não se inventa destinatário.
--   · SUBMIT SEM MUDANÇA NÃO AVISA (S3 da varredura final). O portal reenvia o
--     formulário inteiro; quem abre a tela, confere o número e toca em salvar
--     não trocou nada, e um e-mail dizendo "o aluno atualizou o WhatsApp" seria
--     um aviso sobre um fato que não aconteceu. A comparação é com o valor
--     GRAVADO, lido antes do update.
--     DECLARADO: o `update` e o `log_audit` continuam acontecendo mesmo sem
--     mudança. O update é escrita idempotente do mesmo valor, e a trilha é o
--     registro de que o aluno mexeu no campo — suprimi-la esconderia o gesto de
--     quem for auditar depois. O que se suprime é só o AVISO.
--
-- O PAYLOAD leva o nome do aluno e o número NOVO (é o que a professora precisa
-- para atualizar o contato dela) e o `student_id`/`teacher_id` para trilha. O
-- número velho NÃO vai junto: ele já não é o canal, e o e-mail seria um lugar a
-- mais guardando telefone de alguém. Quem quiser o de/para tem o `audit_log`,
-- que esta mesma função escreve.
--
-- LEI 3: o enfileiramento é do BANCO, na MESMA transação do update. Enfileirar
-- na action (TypeScript) criaria o mundo em que o número muda e o aviso não
-- nasce, que é exatamente o defeito que a RPC do admin veio matar em 28/07.
--
-- ===========================================================================
-- O DEDUPE — A MATRIZ (S2 da varredura final)
-- ===========================================================================
-- O DEFEITO: a chave era `student-wa-changed:<aluno>:<professora>:<dia>` com
-- `on conflict do nothing`. A aluna que corrige o número duas vezes na mesma
-- tarde — digitou errado e conserta — deixava na fila a PRIMEIRA linha, com o
-- número ERRADO, e a segunda era descartada em silêncio. O aviso que existe
-- para a professora ter o número certo ensinava o número que não é.
--
-- A CHAVE AGORA CARREGA O PRÓPRIO NÚMERO:
--     student-wa-changed:<aluno>:<professora>:<dia do negócio>:<E.164>
--
-- E por que não bastava trocar `do nothing` por `do update`: linha JÁ
-- DESPACHADA não pode ser reescrita (o e-mail saiu; mudar o payload dela só
-- apagaria o rastro do que foi enviado), e com a chave sem o número o segundo
-- toque não teria como nascer — a professora ficaria com o número errado, que é
-- o defeito em pior forma. Com o número na chave, correção é FATO NOVO e ganha
-- linha nova; repetição idêntica continua colapsando.
--
-- E por que o `do update` continua necessário mesmo com o número na chave: ele
-- é o que faz a repetição idêntica ser barata e correta sob concorrência (dois
-- envios simultâneos do mesmo número), e garante que a linha pendente daquela
-- chave carregue o payload mais recente (o `student_name` pode ter sido
-- corrigido na ficha entre um toque e outro). O `where … sent_at is null`
-- impede que ele encoste no que já saiu.
--
-- E a TERCEIRA peça, sem a qual as duas primeiras se contradizem: o número na
-- chave faz a linha VELHA e PENDENTE sobreviver ao lado da nova — duas linhas,
-- dois e-mails, o primeiro com o número que já não vale. Por isso o `delete`
-- logo antes do insert. Ele é estreito de propósito: mesmo template, MESMO
-- aluno, `sent_at is null` (nada que já saiu), e só o que fala de um número
-- DIFERENTE do que está sendo gravado agora. É uma promessa não cumprida cujo
-- conteúdo virou falso, não um registro de algo que aconteceu — e o registro do
-- que aconteceu está no `audit_log`, que esta função escreve a cada troca.
-- (`notification_outbox` não é ledger: a Lei 2 fala dos ledgers de crédito, e o
-- próprio despachante já escreve `sent_at`/`error` nas linhas.)
--
-- A MATRIZ, no mesmo dia civil do negócio, para a mesma dupla aluno×professora:
--
--   | o que a aluna faz          | linha anterior     | o que acontece        |
--   |----------------------------|--------------------|-----------------------|
--   | grava o MESMO número       | (não há)           | 1 linha nasce         |
--   | grava o MESMO número       | pendente           | colapsa: 1 linha, o   |
--   |                            |                    | payload é reescrito   |
--   | grava o MESMO número       | JÁ DESPACHADA      | nada nasce (nada mudou|
--   |                            |                    | desde o e-mail que    |
--   |                            |                    | ela já recebeu)       |
--   | CORRIGE para outro número  | pendente           | a pendente MORRE e    |
--   |                            |                    | nasce 1 com o número  |
--   |                            |                    | novo — nunca as duas  |
--   | CORRIGE para outro número  | JÁ DESPACHADA      | nasce linha NOVA: a   |
--   |                            |                    | professora recebe a   |
--   |                            |                    | correção              |
--   | reenvia o formulário sem   | qualquer uma       | nada nasce (S3)       |
--   | mudar nada                 |                    |                       |
--
-- CONSEQUÊNCIAS DECLARADAS:
--   · trocar de novo NO DIA SEGUINTE sai outro aviso — e é o certo, é outra
--     mudança;
--   · o `delete` varre as pendentes de TODAS as professoras do aluno, inclusive
--     a de um contrato que ficou inativo entre um toque e outro: essa linha não
--     renasce, e é o mesmo critério do enqueue (contrato que não corre não
--     avisa);
--   · a chave passa a conter o E.164. Ela nunca vai para a tela (a chave é
--     interna do outbox), mas quem for ler `dedupe_key` numa consulta de
--     suporte verá o telefone ali — assim como já vê no `payload`.

create or replace function public.update_my_whatsapp(p_e164 text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_clean text;
  v_antigo text;
  v_student uuid;
  v_nome text;
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
  -- O QUE ESTAVA GRAVADO, lido ANTES da escrita (S3): é a única forma de saber
  -- se houve troca. `returning` devolveria o valor NOVO, que não responde nada.
  select whatsapp_e164 into v_antigo from profiles where id = auth.uid();
  update profiles set whatsapp_e164 = v_clean where id = auth.uid();
  if not found then
    raise exception 'perfil não encontrado para esta conta';
  end if;
  perform public.log_audit(auth.uid(), 'update_my_whatsapp', 'profiles', auth.uid()::text,
    jsonb_build_object('whatsapp_e164', v_clean));

  -- ------------------------------------------------------------------------
  -- ACRESCENTADO NESTE LOTE: o aviso à professora (ver o cabeçalho).
  -- ------------------------------------------------------------------------
  -- Submit sem mudança não avisa (S3). `is distinct from` e não `<>`: perfil que
  -- ainda não tinha número (NULL) ganhando o primeiro É mudança, e a professora
  -- precisa saber dela.
  if v_antigo is distinct from v_clean then
    select s.id, s.display_name into v_student, v_nome
    from students s where s.profile_id = auth.uid();
    -- Conta autenticada que não é ficha de aluno (admin trocando o próprio
    -- número, professora, conta de serviço) não tem professora a avisar — e o
    -- update acima continua valendo para ela.
    if v_student is not null then
      -- (1) O AVISO QUE AINDA NÃO SAIU E FICOU FALSO NÃO SAI (ver a matriz).
      delete from notification_outbox o
       where o.template = 'student-whatsapp-changed'
         and o.sent_at is null
         and o.payload->>'student_id' = v_student::text
         and o.payload->>'whatsapp_e164' is distinct from v_clean;

      -- (2) O AVISO DO NÚMERO DE AGORA.
      insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key)
      select 'email', 'student-whatsapp-changed', p.profile_id,
             jsonb_build_object(
               'student_id', v_student, 'student_name', v_nome,
               'teacher_id', p.id, 'whatsapp_e164', v_clean),
             format('student-wa-changed:%s:%s:%s:%s',
                    v_student, p.id, public.business_today(), v_clean)
        from (
          -- DISTINCT sobre a PROFESSORA: dois contratos ativos com a mesma
          -- professora (particular + reforço) são um aviso só. O `profile_id`
          -- entra no distinct sem risco de duplicar — ele é função do `id`.
          select distinct t.id, t.profile_id
            from contracts c
            join teachers t on t.id = c.teacher_id
           where c.status = 'active'
             and t.profile_id is not null
             and (
               c.student_id = v_student
               or exists (
                 select 1 from student_group_members m
                  where m.group_id = c.student_group_id and m.student_id = v_student
               )
             )
        ) p
      on conflict (dedupe_key) do update
        set payload = excluded.payload
      where notification_outbox.sent_at is null;
    end if;
  end if;
end;
$$;

-- A ACL não é reemitida porque a ASSINATURA não mudou: os `revoke`/`grant` de
-- `20260728001000` continuam valendo sobre `update_my_whatsapp(text)`. (Fosse
-- assinatura nova, teriam de vir junto — a ACL viaja com a assinatura, não com
-- o nome. É a lição do A6/lote 2.)

comment on function public.update_my_whatsapp(text) is
  'O aluno TROCA o próprio WhatsApp (vazio é recusa: o canal é de contrato). '
  'Desde o lote final da onda da Agenda, a troca também enfileira UM e-mail por '
  'professora distinta dos contratos ATIVOS do aluno (template '
  'student-whatsapp-changed). Submit sem mudança não avisa; repetição do MESMO '
  'número no mesmo dia civil do negócio colapsa em um aviso; CORREÇÃO do número '
  'gera aviso novo e apaga o aviso pendente que ainda ensinaria o número velho '
  '(a chave do dedupe carrega o E.164). Professora sem profile_id é pulada: o '
  'destinatário aqui é interno e conhecido, e linha sem destinatário seria '
  'resolvida tarde pelo despachante como sendo do ALUNO.';
