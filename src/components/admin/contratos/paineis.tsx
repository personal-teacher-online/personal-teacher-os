// OS PAINÉIS DO DETALHE DO CONTRATO (Onda 1 · M4-2) — as oito ações que a tela
// velha empilhava dentro de um `Drawer` do cartão, cada uma agora no Sheet do
// kit, com o rodapé fixo [Cancelar | ação] da anatomia medida.
//
// QUATRO REGRAS QUE ESTE ARQUIVO CARREGA:
//
// 1. AS MUTAÇÕES NÃO FORAM REESCRITAS. Cada formulário aponta para a MESMA
//    server action de `/admin/contratos/actions.ts`, com os MESMOS nomes de
//    campo — e portanto para a mesma RPC, com os mesmos parâmetros. O que mudou
//    é para onde a action volta: um `back` opcional leva o recado de volta ao
//    DETALHE (`AvisoLegado` o transforma em toast). A tela velha, que não manda
//    `back`, continua voltando para si mesma.
// 2. O PAINEL É ENDEREÇO (`?painel=…`, e `?alvo=` quando age sobre uma linha):
//    sobrevive ao F5, ao voltar do navegador e ao link colado.
// 3. ENDEREÇO QUE SÓ PODE FALHAR NÃO VIRA FORMULÁRIO. Renovar com aula pendente,
//    encerrar com aula pendente, pausar o que já está pausado, mexer em contrato
//    encerrado, criar/trocar horário com o fuso ainda no palpite: o banco
//    recusa, então o painel devolve para o detalhe em vez de desenhar um
//    formulário condenado (mesma régua dos painéis `estender` e `anonimizar` da
//    ficha). Quem impede a pessoa de CHEGAR aqui é o `detalhe.tsx`, que
//    desabilita a ação com a frase do porquê (c12 · nº 6); esta linha é a rede
//    de baixo, para o endereço digitado à mão.
// 5. SUCESSO E FALHA TÊM DESTINOS DIFERENTES (c12 · nº 8). Todo formulário leva
//    DOIS endereços: `back` (o detalhe limpo, para quando dá certo) e
//    `back_erro` (este mesmo painel, para quando não dá). Antes só havia o
//    primeiro, e um erro de digitação no type-to-confirm devolvia o detalhe com
//    um toast vermelho e o formulário inteiro apagado — o recado dizia o que
//    houve e a tela não dava onde consertar.
// 4. Nada de `<select>` nativo: quem escolhe entre poucos é RÁDIO (a escolha de
//    consequência do TutorBird), e quem escolhe entre muitos é o Select do kit,
//    com `z-60` para subir acima do véu do Sheet.

import { redirect } from 'next/navigation'

import { DateField } from '@/components/DateField'
import { CAMPO, Campo, GradeDeCampos } from '@/components/admin/alunos/ficha/pecas'
import { PainelDeUrl } from '@/components/kit/painel-de-url'
import { FormValidado } from '@/components/kit/form-validado'
import { SheetBody, SheetFooter, SheetSection } from '@/components/kit/sheet'
import {
  FRASE_DE_CANCELAR_RESERVA,
  PAINEL_DO_CONTRATO_TITULO,
  TETO_DO_MOTIVO,
  enderecoDoContrato,
  painelPedeAutentique,
  type PainelDoContrato,
} from '@/data/admin/contratos-gramatica'
import { TETO_DO_PLANO } from '@/data/admin/contrato-novo'
import { CampoComTeto } from '@/components/kit/campo-com-teto'
import type { FichaDoContrato } from '@/data/admin/contrato-detalhe'
import {
  adjustCreditAction,
  attachSignatureDocumentAction,
  cancelSignatureReservationAction,
  closeAndCreateSlotAction,
  createSlotAction,
  endContractAction,
  pauseContractAction,
  refreshSignatureStatusAction,
  renewContractAction,
  resumeContractAction,
  sendContractForSignatureAction,
  setContractMonthlyValueAction,
  updateContractRulesAction,
} from '@/app/admin/contratos/actions'
import { DestinoDosCreditos, LancamentoDeCredito } from './campos-reativos'
import { FormularioDeHorario } from './FormularioDeHorario'

/** Rodapé fixo padrão: [Cancelar] à esquerda, ação sólida à direita. */
function Rodape({
  voltarPara,
  acao,
  destrutiva,
}: {
  voltarPara: string
  acao: string
  destrutiva?: boolean
}) {
  return (
    <SheetFooter
      cancel={
        // Cancelar é NAVEGAÇÃO de volta ao detalhe — âncora de verdade, que
        // funciona com o teclado, com o meio-clique e sem JS.
        <a href={voltarPara} className="btn-ac-soft btn-ac-lg">
          Cancelar
        </a>
      }
    >
      <button type="submit" className={destrutiva ? 'btn-danger btn-ac-lg' : 'btn-ac btn-ac-lg'}>
        {acao}
      </button>
    </SheetFooter>
  )
}

export function PaineisDoContrato({
  contrato,
  painel,
  alvo,
  /** a chave do Autentique está no ambiente? (ADR-029 §1 — quem responde é a página) */
  assinaturaLigada,
}: {
  contrato: FichaDoContrato
  painel: PainelDoContrato
  /** o alvo da ação quando ela age sobre UMA linha (horário, documento) */
  alvo?: string
  assinaturaLigada: boolean
}) {
  const self = enderecoDoContrato(contrato.id)
  /** O endereço DESTE painel — para onde a falha volta (c12 · nº 8). */
  const aqui = enderecoDoContrato(contrato.id, { painel, alvo })
  const titulo = PAINEL_DO_CONTRATO_TITULO[painel]
  // Contrato ENCERRADO não se edita: a página não oferece lápis nenhum, e o
  // endereço digitado à mão volta para lá em vez de abrir um formulário morto.
  if (contrato.encerrado) redirect(self)
  // ADR-029 §1: e sem a chave do Autentique os TRÊS painéis de assinatura não
  // existem — nem para o endereço colado. É a mesma rede de baixo da linha
  // acima, pelo mesmo motivo: formulário que só pode falhar não vira formulário
  // (regra 3 deste arquivo). Quem impede a pessoa de CHEGAR aqui é o
  // `detalhe.tsx`, que no lugar dos botões mostra o aviso do gate.
  if (!assinaturaLigada && painelPedeAutentique(painel)) redirect(self)

  /** Os três hidden que TODO formulário desta tela carrega. */
  const fixos = (
    <>
      <input type="hidden" name="contract_id" value={contrato.id} />
      <input type="hidden" name="back" value={self} />
      <input type="hidden" name="back_erro" value={aqui} />
    </>
  )

  /* ---------------------------------------------------------------- regras */
  if (painel === 'regras') {
    return (
      <PainelDeUrl titulo={titulo} descricao={contrato.quem} voltarPara={self} bruto>
        <FormValidado action={updateContractRulesAction} className="flex min-h-0 flex-1 flex-col">
          {fixos}
          <SheetBody>
            <SheetSection
              title="O que muda daqui para a frente"
              hint="A alteração é prospectiva e fica auditada no banco: aulas e créditos que já existem não são tocados."
            >
              <GradeDeCampos>
                {/* c13 · nº 8: teto de 80 no nome do plano, em TODA porta que o
                    pede. Ele viaja para a lista de planos das outras telas (a
                    D2 deriva o seletor de `contracts.plan_name`) e, na
                    admissão, para dentro do rascunho da URL — um nome colado de
                    um PDF entope os dois.
                    c16 · r6 nº 12: o `maxLength={80}` saiu. Ele contava unidades
                    UTF-16 e travava a digitação em 40 emojis — mais apertado que
                    o CHECK do banco, que conta caracteres. `CampoComTeto` mede
                    code points e DIZ o que houve, em vez de comer a tecla. */}
                <Campo rotulo="Plano" exigencia="Informe o nome do plano">
                  <CampoComTeto
                    name="plan_name"
                    defaultValue={contrato.plano}
                    required
                    teto={TETO_DO_PLANO}
                    frase={`O nome do plano cabe em ${TETO_DO_PLANO} caracteres.`}
                    className={CAMPO}
                  />
                </Campo>
                {/* O teto é 10 no BANCO (`monthly_reschedule_allowance between
                    0 and 10`): sem o `max`, a tela aceitaria 40 e o contrato
                    morreria no update, com erro de constraint. */}
                <Campo
                  rotulo="Remarcações por mês"
                  apoio="quantas vezes o aluno pode remarcar sem perder a aula — de 0 a 10"
                  exigencia="Informe quantas remarcações o aluno tem por mês (de 0 a 10)"
                >
                  <input
                    name="allowance"
                    type="number"
                    min="0"
                    max="10"
                    required
                    defaultValue={contrato.politica.remarcacoes ?? 4}
                    className={CAMPO}
                  />
                </Campo>
              </GradeDeCampos>
            </SheetSection>
            <SheetSection
              title="O que NÃO muda aqui"
              hint="Valor da aula e professora são decisão registrada, não edição: o caminho é renovar o contrato, que emenda os horários na virada e transfere os créditos. A política da escola (aviso mínimo de 24h · crédito de 90 dias · falha da escola 180 dias) é fixa para todos os contratos."
            />
          </SheetBody>
          <Rodape voltarPara={self} acao="Salvar regras" />
        </FormValidado>
      </PainelDeUrl>
    )
  }

  /* ----------------------------------------------------------- mensalidade */
  // F2 (Onda Financeiro): o número que o previsto da home lê. Mentoria não tem
  // (a RPC recusa e o detalhe nem oferece o lápis).
  if (painel === 'mensalidade') {
    return (
      <PainelDeUrl titulo={titulo} descricao={contrato.quem} voltarPara={self} bruto>
        <FormValidado action={setContractMonthlyValueAction} className="flex min-h-0 flex-1 flex-col">
          {fixos}
          <SheetBody>
            <SheetSection
              title="O valor fixo do mês"
              hint="É o número que o cartão “Previsto no mês” da home soma. Mês de 5 semanas não muda, pausa não desconta, remarcação não mexe — a compensação de pausa é feita em crédito/reposição. Fica auditado no banco (de → para)."
            >
              <GradeDeCampos>
                <Campo
                  rotulo="Mensalidade (R$)"
                  apoio="em reais — ex.: 599,00. Vazio = despublicar (o contrato volta à lista dos sem mensalidade e o previsto lê 0)."
                >
                  <input
                    name="mensalidade"
                    type="text"
                    inputMode="decimal"
                    placeholder="ex.: 599,00"
                    defaultValue={contrato.mensalidadeCampo}
                    className={CAMPO}
                  />
                </Campo>
              </GradeDeCampos>
            </SheetSection>
          </SheetBody>
          <Rodape voltarPara={self} acao="Salvar mensalidade" />
        </FormValidado>
      </PainelDeUrl>
    )
  }

  /* --------------------------------------------------------------- renovar */
  if (painel === 'renovar') {
    // O banco exige contrato ATIVO e zero aula passada sem desfecho.
    if (contrato.situacao !== 'active' || contrato.pendencias > 0) redirect(self)
    return (
      <PainelDeUrl
        titulo={titulo}
        descricao={`${contrato.quem} · ${contrato.plano}`}
        voltarPara={self}
        bruto
      >
        <FormValidado action={renewContractAction} className="flex min-h-0 flex-1 flex-col">
          {fixos}
          <SheetBody>
            <SheetSection
              title="A virada"
              hint="Na data da virada, o contrato atual é encerrado e o novo começa: os horários fixos são emendados, as aulas futuras do antigo dão lugar às novas e os créditos vivos migram com a MESMA validade e duração. Tudo numa transação só, no banco."
            >
              <GradeDeCampos>
                {/* O teto de 8 semanas é do banco ("a virada precisa estar a no
                    máximo 8 semanas"): o campo antecipa as duas pontas. */}
                {/* c12 · nº 10: o PISO é `max(hoje, started_on)`, não "hoje". O
                    banco tem três recusas para esta data, e a terceira nasceu
                    no c12: a virada nunca é anterior ao início do contrato que
                    está sendo renovado (linhagem invertida). Contrato que ainda
                    vai começar tinha, aqui, um campo que aceitava hoje e morria
                    no submit. */}
                <Campo
                  rotulo="Data da virada"
                  apoio={
                    contrato.viradaMinimaIso === contrato.hojeIso
                      ? 'de hoje até 8 semanas à frente'
                      : 'este contrato ainda não começou: a virada vale a partir do início dele, e no máximo 8 semanas à frente'
                  }
                  exigencia="Informe a data da virada"
                >
                  <DateField
                    name="switch_on"
                    required
                    defaultValue={contrato.viradaMinimaIso}
                    min={contrato.viradaMinimaIso}
                    max={contrato.viradaMaximaIso}
                    className={CAMPO}
                  />
                </Campo>
                {/* c16 · r6 nº 12: mesma troca do painel de regras — o teto é de
                    CARACTERES, como o do banco. */}
                <Campo rotulo="Plano novo" exigencia="Informe o nome do plano novo">
                  <CampoComTeto
                    name="plan_name"
                    defaultValue={contrato.plano}
                    required
                    teto={TETO_DO_PLANO}
                    frase={`O nome do plano cabe em ${TETO_DO_PLANO} caracteres.`}
                    className={CAMPO}
                  />
                </Campo>
                <Campo rotulo="Valor da aula (R$)" exigencia="Informe o valor da aula">
                  <input
                    name="hourly_rate"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    defaultValue={contrato.valorHoraCampo}
                    className={CAMPO}
                  />
                </Campo>
                <Campo
                  rotulo="Remarcações por mês"
                  apoio="de 0 a 10"
                  exigencia="Informe quantas remarcações o aluno tem por mês (de 0 a 10)"
                >
                  <input
                    name="allowance"
                    type="number"
                    min="0"
                    max="10"
                    required
                    defaultValue={contrato.politica.remarcacoes ?? 4}
                    className={CAMPO}
                  />
                </Campo>
              </GradeDeCampos>
            </SheetSection>
          </SheetBody>
          <Rodape voltarPara={self} acao="Renovar contrato" />
        </FormValidado>
      </PainelDeUrl>
    )
  }

  /* -------------------------------------------------------------- encerrar */
  if (painel === 'encerrar') {
    if (contrato.pendencias > 0) redirect(self)
    return (
      <PainelDeUrl
        titulo={titulo}
        descricao={`${contrato.quem} · ${contrato.plano}`}
        voltarPara={self}
        bruto
      >
        {/* c12 · nº 9 + c13 · nº 5: o `<input type="hidden" name="confirm_expected">`
            MORREU — ele punha os DOIS lados da comparação nas mãos de quem monta
            o POST (`confirm_name=x&confirm_expected=x` passava). E a comparação
            também saiu do app: o que a pessoa digita viaja como `p_confirm_name`
            e é conferido DENTRO da transação de `admin_end_contract`, contra a
            linha travada. A tela só MOSTRA qual nome ela espera — se a ficha for
            renomeada entre este render e o envio, quem recusa é o banco, com o
            nome novo na frase. */}
        <FormValidado action={endContractAction} className="flex min-h-0 flex-1 flex-col">
          {fixos}
          <SheetBody>
            <SheetSection
              title="O que acontece"
              hint="As aulas futuras deste contrato são canceladas (sem crédito e sem aviso — a conversa com o aluno é humana), os horários fixos são fechados e os créditos vivos vão para onde você mandar abaixo. O histórico fica inteiro: o contrato encerrado continua na ficha do aluno."
            />
            <SheetSection
              title="Para onde vão os créditos vivos"
              hint="Transferir mantém a validade e a duração de cada crédito. Dar baixa exige motivo — é ele que explica, seis meses depois, por que o saldo sumiu."
            >
              {/* c12 · nº 18: os radios e o motivo viraram uma ILHA CLIENTE
                  (`campos-reativos.tsx`) porque a regra do banco é condicional
                  — motivo obrigatório SÓ quando a escolha é dar baixa E há
                  crédito vivo —, e HTML de servidor não sabe dizer isso. */}
              <DestinoDosCreditos
                destinos={contrato.destinos}
                temCreditosVivos={(contrato.creditos.saldo ?? 0) > 0}
                // A6/lote 3: o saldo não enxerga o crédito CONGELADO vencido, e
                // `admin_end_contract` enxerga — ver a nota do componente.
                contratoPausado={contrato.pausado}
              />
            </SheetSection>
            <SheetSection
              title="Confirmação"
              hint="A destrutiva grande exige o nome exato — o mesmo portão da anonimização. Caixa alta ou baixa tanto faz; acento, não."
            >
              <Campo
                rotulo={`Digite o nome EXATO para confirmar: ${contrato.quem}`}
                apoio="sem isso, o encerramento é recusado"
                exigencia="Digite o nome exatamente como está acima"
              >
                <input name="confirm_name" required autoComplete="off" className={CAMPO} />
              </Campo>
            </SheetSection>
          </SheetBody>
          <Rodape voltarPara={self} acao="Encerrar contrato" destrutiva />
        </FormValidado>
      </PainelDeUrl>
    )
  }

  /* ----------------------------------------------------------------- pausa */
  if (painel === 'pausa') {
    const retomar = contrato.situacao === 'paused'
    return (
      <PainelDeUrl
        titulo={titulo}
        descricao={`${contrato.quem} · ${contrato.plano}`}
        voltarPara={self}
        bruto
      >
        <FormValidado
          action={retomar ? resumeContractAction : pauseContractAction}
          className="flex min-h-0 flex-1 flex-col"
        >
          {fixos}
          <SheetBody>
            <SheetSection
              title={retomar ? 'O que a retomada faz' : 'O que a pausa faz'}
              hint={
                retomar
                  ? 'O contrato volta a criar aulas, a validade dos créditos é estendida pelos dias parados, as aulas que ficaram na janela da pausa são canceladas (sem crédito) e a agenda futura é re-materializada. Tudo auditado no banco.'
                  : 'Novas aulas deixam de ser criadas e as já agendadas ficam suspensas (saem da agenda e do extrato — a retomada resolve). Os créditos ficam congelados, sem avisos de vencimento.'
              }
            />
          </SheetBody>
          <Rodape voltarPara={self} acao={retomar ? 'Retomar contrato' : 'Pausar contrato'} />
        </FormValidado>
      </PainelDeUrl>
    )
  }

  /* --------------------------------------------------------------- crédito */
  if (painel === 'credito') {
    return (
      <PainelDeUrl
        titulo={titulo}
        descricao={`${contrato.quem} · saldo hoje: ${contrato.creditos.saldo ?? 0}`}
        voltarPara={self}
        bruto
      >
        <FormValidado action={adjustCreditAction} className="flex min-h-0 flex-1 flex-col">
          {fixos}
          <SheetBody>
            <SheetSection
              title="O lançamento"
              hint="Vira uma linha no ledger (Lei 2: append-only, nunca UPDATE). Positivo dá crédito, negativo tira. O motivo é obrigatório — o banco recusa sem ele."
            >
              {/* c12 · nº 19: a validação HTML passa a dizer a MESMA coisa que
                  `admin_makeup_adjust` — delta ≠ 0, |delta| ≤ 30 e validade
                  obrigatória só no lançamento positivo. As duas últimas são
                  condicionais, daí a ilha cliente. */}
              <LancamentoDeCredito
                validadeSugeridaIso={contrato.creditos.validadeSugeridaIso}
                duracaoSugerida={contrato.creditos.duracaoSugerida}
                validadeDias={contrato.politica.validadeDias ?? 90}
                hojeIso={contrato.hojeIso}
              />
            </SheetSection>
          </SheetBody>
          <Rodape voltarPara={self} acao="Lançar" />
        </FormValidado>
      </PainelDeUrl>
    )
  }

  /* ------------------------------------------------------------ assinatura */
  if (painel === 'assinatura') {
    // `?alvo=<documento>` é a segunda página do assunto: consultar o estado de
    // um documento que já foi enviado (mesma convenção do `?alvo=novo` da ficha).
    const documento = contrato.assinaturas.find((a) => a.documento === alvo && !a.terminal)
    if (alvo && !documento) redirect(self)
    if (documento) {
      return (
        <PainelDeUrl
          titulo="Situação da assinatura"
          descricao={`${contrato.quem} · ${documento.rotulo}`}
          voltarPara={self}
          bruto
        >
          <FormValidado action={refreshSignatureStatusAction} className="flex min-h-0 flex-1 flex-col">
            {/* c14: `?? ''` é formalidade — o painel só existe quando `alvo` casou com
                um documento, e reserva sem documento nunca casa. */}
            <input type="hidden" name="provider_document_id" value={documento.documento ?? ''} />
            <input type="hidden" name="back" value={self} />
            {/* c13 · nº 3: este formulário e o da troca de horário eram os DOIS
                que tinham ficado só com o `back` — a consulta que falha (token
                ausente, Autentique fora do ar) devolvia o detalhe limpo, e a
                pessoa tinha de reabrir o painel para tentar de novo. O par
                `back`/`back_erro` agora é varrido por teste, formulário a
                formulário, e não por uma ocorrência qualquer no arquivo. */}
            <input type="hidden" name="back_erro" value={aqui} />
            <SheetBody>
              <SheetSection
                title="Consultar o Autentique agora"
                hint="A consulta pergunta ao Autentique o que aconteceu com o documento e aplica a transição pela mesma função do webhook — o estado nunca é escrito à mão. Estados terminais (assinado, recusado) não mudam mais."
              >
                {/* c16 · r6 nº 8: "vinculado em", não "enviado em" — o carimbo é
                    o do momento em que o documento casou com esta reserva, e
                    quando o casamento foi um ANEXO humano ele nada diz sobre a
                    hora do envio. */}
                <p className="text-sm leading-relaxed text-ink-900">
                  Documento vinculado em {documento.vinculadaEm ?? '—'}. Situação registrada aqui:{' '}
                  <span className="font-medium">{documento.rotulo}</span>.
                </p>
              </SheetSection>
            </SheetBody>
            <Rodape voltarPara={self} acao="Consultar agora" />
          </FormValidado>
        </PainelDeUrl>
      )
    }
    return (
      <PainelDeUrl
        titulo={titulo}
        descricao={`${contrato.quem} · ${contrato.plano}`}
        voltarPara={self}
        bruto
      >
        <FormValidado
          action={sendContractForSignatureAction}
          className="flex min-h-0 flex-1 flex-col"
        >
          {fixos}
          <SheetBody>
            <SheetSection
              title="Confira antes de anexar"
              hint="O PDF é o documento que vale juridicamente: os números dele têm de bater com os do sistema."
            >
              <p className="text-sm leading-relaxed text-ink-900">
                Valor da aula no sistema:{' '}
                <span className="font-medium">{contrato.valorHora ?? '—'}</span> · aviso mínimo{' '}
                <span className="font-medium">{contrato.politica.avisoHoras ?? 24} h</span> ·{' '}
                <span className="font-medium">{contrato.politica.remarcacoes ?? 0}</span>{' '}
                remarcações/mês.
              </p>
            </SheetSection>
            <SheetSection
              title="Quem assina"
              hint="Contrato de casal assina em dois e-mails. O documento nasce no Autentique e o espelho local guarda o estado."
            >
              <GradeDeCampos>
                <Campo rotulo="PDF do contrato" largo exigencia="Anexe o PDF do contrato">
                  <input
                    name="pdf"
                    type="file"
                    accept="application/pdf"
                    required
                    className={`${CAMPO} file:mr-2 file:rounded-pill file:border-0 file:bg-paper-100 file:px-2 file:py-0.5 file:text-ink-600`}
                  />
                </Campo>
                <Campo rotulo="E-mail do signatário" exigencia="Informe o e-mail de quem assina">
                  <input
                    name="signer_email"
                    type="email"
                    required
                    placeholder="ex.: aluno@exemplo.com"
                    className={CAMPO}
                  />
                </Campo>
                <Campo rotulo="2º signatário" apoio="opcional — contrato de casal">
                  <input
                    name="signer_email_2"
                    type="email"
                    placeholder="ex.: segundo@exemplo.com"
                    className={CAMPO}
                  />
                </Campo>
                <Campo
                  rotulo="Nome do documento"
                  largo
                  apoio="opcional — em branco, vale o nome do plano"
                >
                  <input name="doc_name" placeholder={contrato.plano} className={CAMPO} />
                </Campo>
              </GradeDeCampos>
            </SheetSection>
          </SheetBody>
          <Rodape voltarPara={self} acao="Enviar para assinatura" />
        </FormValidado>
      </PainelDeUrl>
    )
  }

  /* ------------------------------------------- reserva de assinatura (c15) */
  //
  // OS DOIS ATOS HUMANOS que substituíram o reclaim automático de 30 minutos do
  // c14 (ele roubava reserva viva: um envio lento perdia a vaga e nascia um
  // segundo documento). Os dois agem sobre a MESMA linha — `?alvo=<reserva>`,
  // que é o id do espelho, e não o do documento, justamente porque documento
  // ainda não há.
  //
  // Endereço que só pode falhar não vira formulário (regra 3 deste arquivo):
  // sem alvo, ou com alvo que não é reserva ABERTA deste contrato, o painel
  // volta para o detalhe — as duas RPCs recusariam de qualquer jeito.
  if (painel === 'reserva-anexar' || painel === 'reserva-cancelar') {
    const reserva = contrato.assinaturas.find((a) => a.id === alvo && a.reservaAberta)
    if (!reserva) redirect(self)

    if (painel === 'reserva-anexar') {
      return (
        <PainelDeUrl
          titulo={titulo}
          descricao={`${contrato.quem} · pedido aberto em ${reserva.reservadaEm}`}
          voltarPara={self}
          bruto
        >
          <FormValidado
            action={attachSignatureDocumentAction}
            className="flex min-h-0 flex-1 flex-col"
          >
            {/* Os hidden deste par de painéis: a RESERVA (e não o contrato) é
                o alvo, mais os dois destinos de sempre — sucesso volta ao
                detalhe, falha reabre este painel. Escritos por extenso nos DOIS
                formulários de propósito: a varredura do c13 confere formulário a
                formulário, e um `{atalho}` compartilhado a cegaria. */}
            <input type="hidden" name="signature_id" value={reserva.id} />
            <input type="hidden" name="back" value={self} />
            <input type="hidden" name="back_erro" value={aqui} />
            <SheetBody>
              <SheetSection
                title="Quando usar isto"
                hint="O envio ficou sem resposta (rede caiu, tempo estourou) e, ao conferir o painel do Autentique, o documento ESTAVA lá. Anexar o id casa aquele documento com esta reserva: o estado dele volta a ser acompanhado aqui, inclusive os avisos que chegaram enquanto o espelho não existia."
              />
              <SheetSection
                title="O id do documento"
                hint="Ele é a sequência de letras e números que aparece na URL do documento no Autentique — não o nome do arquivo."
              >
                <GradeDeCampos>
                  <Campo
                    rotulo="Id do documento no Autentique"
                    largo
                    exigencia="Cole o id do documento"
                  >
                    <input
                      name="provider_document_id"
                      required
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="ex.: 3f9a1c7e5b2d4a8f6c0e9b1d7a3f5c2e"
                      className={CAMPO}
                    />
                  </Campo>
                </GradeDeCampos>
              </SheetSection>
            </SheetBody>
            <Rodape voltarPara={self} acao="Anexar documento" />
          </FormValidado>
        </PainelDeUrl>
      )
    }

    return (
      <PainelDeUrl
        titulo={titulo}
        descricao={`${contrato.quem} · pedido aberto em ${reserva.reservadaEm}`}
        voltarPara={self}
        bruto
      >
        <FormValidado
          action={cancelSignatureReservationAction}
          className="flex min-h-0 flex-1 flex-col"
        >
          {/* Os mesmos hidden do painel irmão, escritos por extenso: a varredura
              do c13 confere formulário a formulário. */}
          <input type="hidden" name="signature_id" value={reserva.id} />
          <input type="hidden" name="back" value={self} />
          <input type="hidden" name="back_erro" value={aqui} />
          <SheetBody>
            <SheetSection
              title="O que isto faz"
              hint="Marca esta reserva como envio não concluído e LIBERA o próximo envio deste contrato. Se o documento existir no Autentique e você cancelar mesmo assim, o próximo envio cria um SEGUNDO contrato para o aluno assinar — é por isso que a confirmação abaixo é uma instrução, e não o nome do aluno."
            />
            <SheetSection
              title="Confirmação"
              hint="Digite a frase exatamente como está. Caixa e espaço a mais não importam; a frase, sim."
            >
              <GradeDeCampos>
                <Campo
                  rotulo={`Digite para confirmar: ${FRASE_DE_CANCELAR_RESERVA}`}
                  largo
                  exigencia="Digite a frase de confirmação"
                >
                  <input
                    name="confirm_phrase"
                    required
                    autoComplete="off"
                    className={CAMPO}
                  />
                </Campo>
                {/* c16 · r6 nº 13: o teto de 200 desceu para a RPC
                    (`admin_cancel_signature`, `char_length`) — era só um
                    `maxLength` de tela, que não vale para POST montado à mão e
                    ainda media UTF-16. Aqui ficou a antecipação, em code points
                    e com frase. */}
                <Campo
                  rotulo="Motivo"
                  largo
                  apoio="fica no histórico — é ele que explica, meses depois, por que esta reserva morreu sem documento"
                  exigencia="Diga o motivo do cancelamento"
                >
                  <CampoComTeto
                    name="reason"
                    required
                    teto={TETO_DO_MOTIVO}
                    frase={`O motivo cabe em ${TETO_DO_MOTIVO} caracteres — diga o essencial: o que você conferiu no painel do Autentique.`}
                    placeholder="ex.: confirmei no Autentique, o documento não foi criado"
                    className={CAMPO}
                  />
                </Campo>
              </GradeDeCampos>
            </SheetSection>
          </SheetBody>
          <Rodape voltarPara={self} acao="Cancelar reserva" destrutiva />
        </FormValidado>
      </PainelDeUrl>
    )
  }

  /* ------------------------------------------------------- horário: trocar */
  if (painel === 'horario-trocar') {
    const horario = contrato.horarios.find((h) => h.id === alvo)
    // Sem alvo, ou com alvo que não é horário VIVO deste contrato, o painel não
    // abre: `close_and_create_slot` recusaria de qualquer jeito.
    if (!horario) redirect(self)
    // c12 · nº 6: e com o fuso ainda no palpite o banco recusa TODO horário
    // fixo (`_require_confirmed_tz`). O detalhe já desabilita a ação com a
    // frase do porquê; isto é a rede para o endereço digitado à mão.
    if (!contrato.fusoConfirmado) redirect(self)
    return (
      <PainelDeUrl
        titulo={titulo}
        descricao={`${contrato.quem} · hoje ${horario.texto}`}
        voltarPara={self}
        bruto
      >
        <FormularioDeHorario
          action={closeAndCreateSlotAction}
          camposFixos={
            <>
              <input type="hidden" name="slot_id" value={horario.id} />
              <input type="hidden" name="back" value={self} />
              {/* c13 · nº 3: a troca de horário é o formulário mais fácil de
                  errar da tela (conflito de agenda é recusa do banco) e era o
                  que voltava para o detalhe limpo. `back_erro` reabre ESTE
                  painel, com o alvo. */}
              <input type="hidden" name="back_erro" value={aqui} />
            </>
          }
          professoraId={contrato.professora.id}
          professoraNome={contrato.professora.nome ?? 'A professora'}
          // A troca fecha ESTE horário e cancela as aulas futuras dele antes de
          // criar o novo: ele não disputa consigo mesmo.
          ocupacao={contrato.ocupacao.filter((j) => j.slotId !== horario.id)}
          fuso={contrato.fusoDoHorario.rotulo}
          ancora={contrato.grupo ? { defaultTz: horario.ianaTz } : null}
          weekdayInicial={horario.weekday}
          horaInicial={horario.hora}
          duracaoInicial={horario.duracao}
          duracaoEditavel={false}
          rodape={<Rodape voltarPara={self} acao="Trocar horário" />}
        />
      </PainelDeUrl>
    )
  }

  /* --------------------------------------------------------- horário: novo */
  if (painel === 'horario-novo') {
    // c12 · nº 6: mesma rede do painel de troca — `create_slot` recusa horário
    // fixo de quem ainda tem a cidade por confirmar.
    if (!contrato.fusoConfirmado) redirect(self)
    return (
      <PainelDeUrl titulo={titulo} descricao={contrato.quem} voltarPara={self} bruto>
        <FormularioDeHorario
          action={createSlotAction}
          camposFixos={fixos}
          professoraId={contrato.professora.id}
          professoraNome={contrato.professora.nome ?? 'A professora'}
          // No horário NOVO nada se ignora: se ele atropelar um horário que este
          // mesmo contrato já tem, o banco recusa igual.
          ocupacao={contrato.ocupacao}
          fuso={contrato.fusoDoHorario.rotulo}
          ancora={contrato.grupo ? { defaultTz: contrato.fusoDoHorario.iana } : null}
          weekdayInicial={1}
          horaInicial=""
          duracaoInicial={contrato.creditos.duracaoSugerida}
          duracaoEditavel
          rodape={<Rodape voltarPara={self} acao="Criar horário" />}
        />
      </PainelDeUrl>
    )
  }

  // Painel que a gramática conhece mas esta tela não desenha não existe: o
  // `PainelDoContrato` é fechado, então este ponto só é alcançável por um
  // painel novo que alguém acrescentou sem montar o formulário. Voltar para o
  // detalhe é a resposta honesta — melhor que uma tela em branco.
  redirect(self)
}
