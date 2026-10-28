// OS PAINÉIS DA FICHA (Onda 1 · M3-2) — todo formulário da ficha abre no Sheet
// do kit, com o rodapé FIXO [Cancelar | Salvar] da anatomia medida.
//
// TRÊS REGRAS QUE ESTE ARQUIVO CARREGA:
//
// 1. As MUTAÇÕES NÃO FORAM REESCRITAS. Cada `<FormValidado action={…}>` aponta para a
//    MESMA server action da ficha velha, que continua terminando em
//    `redirect('/admin/alunos/<id>?msg=…&n=…')`. Quem transforma esse recado em
//    toast é o `AvisoLegado` da página — o mesmo truque de convivência do M3-1.
//    Quando essas actions migrarem para `src/data/admin/actions.ts`
//    (`ResultadoDaAcao` + toast), só o meio muda; o formulário fica.
// 2. O PAINEL É ENDEREÇO (`?painel=…`): é o que faz `?painel=convidar` (link
//    salvo, e o que o hub do M3-1 aponta) continuar funcionando, e é o que faz
//    o painel sobreviver ao F5 e ao voltar do navegador.
// 3. Nada de `<select>` nativo (objeção nº 1 do dono): quem seleciona é o
//    Select do kit. Dentro do Sheet ele precisa subir acima do véu (z-50) —
//    daí o `z-60` no conteúdo do menu.
// 4. (M3-c4 · B3) O elemento de formulário é o `FormValidado` do kit, não o
//    `<form>` cru: campo obrigatório vazio ganha borda vermelha e frase EM
//    BAIXO dele, e o foco vai ao primeiro erro — o balão nativo do navegador
//    morre. Cada `Campo` obrigatório escreve a sua `exigencia` em português da
//    casa. Isto é ANTECIPAÇÃO: a action e o banco continuam recusando de novo.
import { redirect } from 'next/navigation'

import {
  EtapaFechar,
  EtapaHistoria,
  EtapaHistoriaV2,
  EtapaInteresses,
  EtapaInteressesV2,
  EtapaKolb,
  EtapaObjetivos,
  EtapaObjetivosV2,
  EtapaRotina,
  type BriefingAnswers,
} from '@/components/BriefingFields'
import { CityPicker } from '@/components/CityPicker'
import { CountryPhoneField } from '@/components/CountryPhoneField'
import { DateField } from '@/components/DateField'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/kit/select'
import { FormValidado } from '@/components/kit/form-validado'
import { SheetBody, SheetFooter, SheetSection } from '@/components/kit/sheet'
import {
  NIVEIS_DO_CADASTRO,
  SEM_NIVEL_NO_FORM,
  TIPO_DE_ALUNO,
  enderecoDaFicha,
  type Painel,
} from '@/data/admin/ficha-gramatica'
import type { FichaDoAluno } from '@/data/admin/ficha'
import { SECOES_DE_RESPOSTA, ehSecaoBriefing } from '@/lib/briefing/leitura'
import type { SecaoBriefing, VersaoBriefing } from '@/lib/briefing/schema'
import { extendCreditAction } from '@/app/admin/credit-actions'
import { cancelClassAction } from '@/app/admin/agenda/actions'
import {
  adminFillBriefingAction,
  adminReviseBriefingAction,
  anonymizeStudentAction,
  createPayerAction,
  inviteStudentAction,
  linkPayerAction,
  loseLeadAction,
  setStudentNoteAction,
  updateStudentAction,
  updateStudentWhatsappAction,
} from '@/app/admin/alunos/actions'
import { PainelDeUrl } from '@/components/kit/painel-de-url'
import { CancelarAula } from './CancelarAula'
import { CAMPO, Campo, GradeDeCampos } from './pecas'

/** As duas opções de `students.student_type`, na ordem em que a tela pergunta. */
const TIPOS_DE_ALUNO = ['adult', 'child'] as const

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
        // Cancelar é NAVEGAÇÃO de volta à ficha — âncora de verdade, que
        // funciona com o teclado, com o meio-clique e sem JS.
        //
        // M3-c4 · B4 — mas com CARA DE BOTÃO (`.btn-ac-soft`, contorno), não de
        // link. O fantasma (`.btn-ac-ghost`) é texto no acento sem borda nem
        // fundo: no rodapé, ao lado do sólido, ele lê como link-texto — o padrão
        // que o dono já baniu três vezes. Ação de rodapé é botão.
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

/**
 * Os campos de UMA etapa do briefing, na versão da LINHA e no ramo do aluno.
 *
 * Um lugar só porque dois painéis os usam: o preenchimento por telefone (as 6
 * etapas empilhadas) e a correção pós-envio (uma etapa por vez). Nenhum
 * enunciado é escrito aqui — as peças de `BriefingFields` leem o dicionário.
 * `required={false}` sempre: quem preenche por telefone salva parcial, e quem
 * corrige mexe num campo só; quem recusa de verdade é o banco (Lei 3).
 */
function CamposDaEtapa({
  secao,
  respostas,
  versao,
  tipo,
}: {
  secao: SecaoBriefing
  respostas: BriefingAnswers
  versao: VersaoBriefing
  tipo: 'child' | 'adult'
}) {
  if (secao === 'historia')
    return versao === 1 ? (
      <EtapaHistoria a={respostas} required={false} />
    ) : (
      <EtapaHistoriaV2 a={respostas} required={false} />
    )
  if (secao === 'objetivos')
    return versao === 1 ? (
      <EtapaObjetivos a={respostas} required={false} />
    ) : (
      <EtapaObjetivosV2 a={respostas} tipo={tipo} required={false} />
    )
  if (secao === 'interesses')
    return versao === 1 ? (
      <EtapaInteresses a={respostas} required={false} />
    ) : (
      <EtapaInteressesV2 a={respostas} required={false} />
    )
  // Etapas 4 (rotina) e 6 (fechar) são as MESMAS peças nas duas versões — a
  // spec do v2 manteve a rotina intocada, e o fechamento só ganhou "apoio".
  if (secao === 'rotina') return <EtapaRotina a={respostas} required={false} />
  return <EtapaFechar a={respostas} versao={versao} />
}

const TITULOS: Record<Painel, string> = {
  editar: 'Editar cadastro',
  whatsapp: 'WhatsApp do aluno',
  convidar: 'Convidar para o portal',
  pagador: 'Pagador',
  anonimizar: 'Anonimizar ex-aluno',
  briefing: 'Briefing em nome do aluno',
  estender: 'Estender a validade de um crédito',
  cancelar: 'Cancelar aula',
  nota: 'Nota interna',
  perder: 'Lead perdido',
  'briefing-correcao': 'Corrigir uma resposta do briefing',
}

export function PaineisDaFicha({
  ficha,
  painel,
  alvo,
  digitado,
}: {
  ficha: FichaDoAluno
  painel: Painel
  /** o alvo da ação quando ela age sobre UMA linha (crédito, aula) */
  alvo?: string
  /**
   * O que a dona tinha escolhido e o banco recusou (revisão independente do
   * A6, M2). Quem LÊ o cookie é a página (Server Component); aqui ele só é
   * repassado ao painel que sabe o que fazer com ele — hoje, só o "cancelar".
   */
  digitado?: Record<string, string>
}) {
  const self = enderecoDaFicha(ficha.id)
  const titulo = TITULOS[painel]

  /* ------------------------------------------------------------- cadastro */
  if (painel === 'editar') {
    return (
      <PainelDeUrl titulo={titulo} descricao={ficha.nome} voltarPara={self} bruto>
        <FormValidado action={updateStudentAction} className="flex min-h-0 flex-1 flex-col">
          <input type="hidden" name="student_id" value={ficha.id} />
          <input type="hidden" name="back" value={self} />
          <SheetBody>
            <SheetSection
              title="Quem é o aluno"
              hint="A cidade define o fuso: os horários das aulas convertem sozinhos quando ela muda."
            >
              <GradeDeCampos>
                <Campo rotulo="Nome" exigencia="Informe o nome do aluno">
                  <input name="display_name" defaultValue={ficha.nome} required className={CAMPO} />
                </Campo>
                {/* M3-c5 · D1 — os mesmos três campos da etapa 1 do wizard. */}
                <Campo rotulo="Tipo de aluno" para="tipo-do-aluno">
                  <Select name="student_type" defaultValue={ficha.tipo}>
                    <SelectTrigger id="tipo-do-aluno" className="min-h-11 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-60">
                      {TIPOS_DE_ALUNO.map((t) => (
                        <SelectItem key={t} value={t}>
                          {TIPO_DE_ALUNO[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Campo>
                <Campo rotulo="Nascimento" apoio="opcional">
                  <DateField
                    name="birth_date"
                    defaultValue={ficha.nascimentoIso ?? undefined}
                    className={CAMPO}
                  />
                </Campo>
                <Campo rotulo="Como conheceu a escola" apoio="opcional">
                  <input
                    name="referral_source"
                    defaultValue={ficha.comoConheceu ?? ''}
                    placeholder="ex.: indicação da Mariana"
                    className={CAMPO}
                  />
                </Campo>
                <Campo rotulo="Nível" para="nivel-do-aluno" apoio="deixe em branco até a avaliação">
                  <Select name="level" defaultValue={ficha.nivel ?? SEM_NIVEL_NO_FORM}>
                    <SelectTrigger id="nivel-do-aluno" className="min-h-11 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-60">
                      <SelectItem value={SEM_NIVEL_NO_FORM}>ainda não avaliado</SelectItem>
                      {NIVEIS_DO_CADASTRO.map((n) => (
                        <SelectItem key={n} value={n}>
                          {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Campo>
                <Campo rotulo="Cidade do aluno" largo exigencia="Informe a cidade do aluno">
                  <CityPicker
                    tzName="iana_tz"
                    cityName="city"
                    countryName="country"
                    defaultTz={ficha.ianaTz}
                    defaultCity={ficha.cidadeCanonica}
                    defaultCountry={ficha.pais}
                    required
                  />
                </Campo>
              </GradeDeCampos>
            </SheetSection>
            <SheetSection
              title="Contato"
              hint="O WhatsApp mora no login do aluno — por isso ele se edita à parte."
            >
              {ficha.temLogin ? (
                <a
                  href={enderecoDaFicha(ficha.id, { painel: 'whatsapp' })}
                  className="btn-ac-soft self-start"
                >
                  Editar WhatsApp
                </a>
              ) : (
                <p className="text-sm leading-relaxed text-ink-600">
                  Convide o aluno primeiro — o número de WhatsApp vive no login dele.
                </p>
              )}
            </SheetSection>
          </SheetBody>
          <Rodape voltarPara={self} acao="Salvar" />
        </FormValidado>
      </PainelDeUrl>
    )
  }

  /* ----------------------------------------------------------------- nota */
  if (painel === 'nota') {
    return (
      <PainelDeUrl
        titulo={titulo}
        descricao={`Sobre ${ficha.nome} — só a equipe lê.`}
        voltarPara={self}
        bruto
      >
        <FormValidado action={setStudentNoteAction} className="flex min-h-0 flex-1 flex-col">
          <input type="hidden" name="student_id" value={ficha.id} />
          <SheetBody>
            <SheetSection
              title="O que a equipe precisa saber"
              hint="Visível só para você e para a professora deste aluno — NUNCA para o aluno. Ela mora em tabela própria, fora do cadastro que o portal lê. Apagar tudo e salvar remove a nota."
            >
              <Campo rotulo="Nota" largo>
                <textarea
                  name="note"
                  defaultValue={ficha.notaInterna?.texto ?? ''}
                  rows={6}
                  placeholder="ex.: prefere aula de manhã; a mãe acompanha as remarcações"
                  className={`${CAMPO} min-h-32`}
                />
              </Campo>
            </SheetSection>
          </SheetBody>
          <Rodape voltarPara={self} acao="Salvar nota" />
        </FormValidado>
      </PainelDeUrl>
    )
  }

  /* ------------------------------------------------------------- whatsapp */
  if (painel === 'whatsapp') {
    return (
      <PainelDeUrl titulo={titulo} descricao={ficha.nome} voltarPara={self} bruto>
        <FormValidado action={updateStudentWhatsappAction} className="flex min-h-0 flex-1 flex-col">
          <input type="hidden" name="student_id" value={ficha.id} />
          <SheetBody>
            <SheetSection
              title="Número de WhatsApp"
              // A6 · prova independente L2: "Avisos" é o nome da ROTA; o item
              // do menu chama Mensagens (`nav.ts`).
              hint="Com número, os avisos (lembrete de aula, crédito vencendo) também são registrados para envio por WhatsApp — se saíram, você confere em Mensagens. Vazio desliga o canal; o e-mail continua."
            >
              {/* `para` (e não rótulo embrulhando o campo): o seletor de país é
                  um `<button>`, e um `<label>` que embrulha este campo rotula o
                  BOTÃO — clicar no rótulo abria a lista de DDI em vez de focar o
                  número, e o clique na opção voltava reencaminhado ao gatilho,
                  reabrindo a lista (M3-c4 · B1). */}
              <Campo rotulo="WhatsApp" para="whatsapp-do-aluno" apoio="país + número local">
                <CountryPhoneField
                  id="whatsapp-do-aluno"
                  name="whatsapp_e164"
                  defaultValue={ficha.whatsapp}
                />
              </Campo>
            </SheetSection>
          </SheetBody>
          <Rodape voltarPara={self} acao="Salvar" />
        </FormValidado>
      </PainelDeUrl>
    )
  }

  /* ------------------------------------------------------------- convidar */
  if (painel === 'convidar') {
    if (ficha.temLogin) redirect(self)
    return (
      <PainelDeUrl
        titulo={titulo}
        descricao={`${ficha.nome} recebe um e-mail para criar a senha dele.`}
        voltarPara={self}
        bruto
      >
        <FormValidado action={inviteStudentAction} className="flex min-h-0 flex-1 flex-col">
          <input type="hidden" name="student_id" value={ficha.id} />
          <SheetBody>
            <SheetSection
              title="Para onde vai o convite"
              hint="O e-mail vira o login do portal. O WhatsApp entra junto porque o contrato já prevê os avisos por lá — é para esse número que saem os lembretes."
            >
              <GradeDeCampos>
                <Campo rotulo="E-mail do aluno" exigencia="Informe o e-mail do aluno">
                  <input
                    name="email"
                    type="email"
                    required
                    placeholder="ex.: aluno@exemplo.com"
                    className={CAMPO}
                  />
                </Campo>
                {/* Correção 28/07: mesma régua do wizard — quem ganha acesso
                    ganha com número. Ver o comentário em AdmissionWizard. */}
                <Campo
                  rotulo="WhatsApp"
                  para="whatsapp-do-convite"
                  apoio="o aluno pode trocar no portal"
                  exigencia="Informe o WhatsApp do aluno"
                >
                  <CountryPhoneField id="whatsapp-do-convite" name="whatsapp_e164" required />
                </Campo>
              </GradeDeCampos>
            </SheetSection>
          </SheetBody>
          <Rodape voltarPara={self} acao="Convidar" />
        </FormValidado>
      </PainelDeUrl>
    )
  }

  /* -------------------------------------------------------------- pagador */
  if (painel === 'pagador') {
    // `?alvo=novo` é a segunda página do assunto: criar um pagador do zero.
    if (alvo === 'novo') {
      return (
        <PainelDeUrl titulo="Criar pagador" descricao={ficha.nome} voltarPara={self} bruto>
          <FormValidado action={createPayerAction} className="flex min-h-0 flex-1 flex-col">
            <input type="hidden" name="student_id" value={ficha.id} />
            <SheetBody>
              <SheetSection
                title="Quem paga"
                hint="É quem recebe a cobrança no Asaas — pode ser o próprio aluno, um responsável ou a empresa."
              >
                <GradeDeCampos>
                  <Campo rotulo="Nome do pagador" exigencia="Informe o nome do pagador">
                    <input name="name" required className={CAMPO} />
                  </Campo>
                  <Campo rotulo="E-mail" apoio="opcional">
                    <input name="email" type="email" className={CAMPO} />
                  </Campo>
                  <Campo rotulo="CPF/CNPJ" apoio="opcional" largo>
                    <input name="cpf_cnpj" className={CAMPO} />
                  </Campo>
                </GradeDeCampos>
              </SheetSection>
            </SheetBody>
            <Rodape voltarPara={self} acao="Criar e vincular" />
          </FormValidado>
        </PainelDeUrl>
      )
    }
    return (
      <PainelDeUrl titulo={titulo} descricao={ficha.nome} voltarPara={self} bruto>
        <FormValidado action={linkPayerAction} className="flex min-h-0 flex-1 flex-col">
          <input type="hidden" name="student_id" value={ficha.id} />
          <SheetBody>
            <SheetSection
              title="Vincular um pagador que já existe"
              hint="Um responsável pode pagar por mais de um aluno — por isso o cadastro é separado."
            >
              {/* B6 · item 2: a lista traz só quem NÃO está vinculado (o filtro
                  é da camada de dados). As duas ausências são coisas
                  diferentes, e a frase distingue: não existe pagador nenhum ×
                  todos os que existem já são deste aluno. */}
              {ficha.pagadoresDisponiveis.length === 0 ? (
                <p className="text-sm leading-relaxed text-ink-600">
                  {ficha.pagadores.length > 0
                    ? 'Todos os pagadores cadastrados já estão vinculados a este aluno. Crie um novo abaixo.'
                    : 'Nenhum pagador cadastrado ainda. Crie o primeiro abaixo.'}
                </p>
              ) : (
                <Campo
                  rotulo="Pagador"
                  para="pagador-existente"
                  exigencia="Escolha o pagador"
                >
                  {/* `required` no Select do kit funciona porque o formulário
                      leva `noValidate` (M3-c4 · B3): o `<select>` escondido do
                      Radix continua sendo quem reprova, mas quem MOSTRA o erro
                      e recebe o foco é o gatilho visível. Sem isso, um contrato
                      sem pagador só falharia na action. */}
                  <Select name="payer_id" required>
                    <SelectTrigger id="pagador-existente" className="min-h-11 w-full">
                      <SelectValue placeholder="Escolha…" />
                    </SelectTrigger>
                    <SelectContent className="z-60">
                      {ficha.pagadoresDisponiveis.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Campo>
              )}
            </SheetSection>
            <SheetSection title="Ou crie um novo" hint="Nome, e-mail e CPF/CNPJ — o resto vem do Asaas.">
              <a
                href={enderecoDaFicha(ficha.id, { painel: 'pagador', alvo: 'novo' })}
                className="btn-ac-soft self-start"
              >
                Criar pagador
              </a>
            </SheetSection>
          </SheetBody>
          <Rodape voltarPara={self} acao="Vincular" />
        </FormValidado>
      </PainelDeUrl>
    )
  }

  /* ----------------------------------------------------------- anonimizar */
  if (painel === 'anonimizar') {
    // B6 · item 1: com contrato vivo a RPC recusa — e o gesto nem é oferecido
    // na aba. O endereço digitado à mão volta para a ficha em vez de abrir um
    // formulário que só pode falhar (mesma régua do painel `estender`).
    if (ficha.contratos.length > 0) redirect(self)
    return (
      <PainelDeUrl
        titulo={titulo}
        descricao="Irreversível — exige todos os contratos encerrados."
        voltarPara={self}
        bruto
      >
        <FormValidado action={anonymizeStudentAction} className="flex min-h-0 flex-1 flex-col">
          <input type="hidden" name="student_id" value={ficha.id} />
          <SheetBody>
            <SheetSection
              title="O que acontece"
              hint="Nome, cidade e nível viram genéricos, o login é destruído e o WhatsApp sai da caixa. O esqueleto operacional (aulas, créditos, extratos, auditoria) fica; relatórios já ENVIADOS ficam; pagador com cobrança real fica 5 anos, por obrigação fiscal."
            >
              {/* type-to-confirm: a destrutiva só arma quando a pessoa escreve o
                  nome exato — o mesmo portão da ficha velha. */}
              <Campo
                rotulo={`Digite o nome EXATO para confirmar: ${ficha.nome}`}
                apoio="sem isso, o banco recusa"
                exigencia="Digite o nome do aluno, exatamente como está acima"
              >
                <input name="confirm_name" required autoComplete="off" className={CAMPO} />
              </Campo>
            </SheetSection>
          </SheetBody>
          <Rodape voltarPara={self} acao="Anonimizar de vez" destrutiva />
        </FormValidado>
      </PainelDeUrl>
    )
  }

  /* --------------------------------------------------------- lead perdido */
  if (painel === 'perder') {
    // Só quem o BANCO conhece como lead: `admin_lose_lead` recusa o resto, e
    // endereço digitado à mão não vira formulário que só pode falhar (mesma
    // régua dos painéis `anonimizar` e `estender`).
    if (!ficha.ehLead) redirect(self)
    return (
      <PainelDeUrl
        titulo={titulo}
        descricao={`${ficha.nome} sai da lista de trabalho e fica arquivado.`}
        voltarPara={self}
        bruto
      >
        <FormValidado action={loseLeadAction} className="flex min-h-0 flex-1 flex-col">
          <input type="hidden" name="student_id" value={ficha.id} />
          <SheetBody>
            <SheetSection
              title="O que acontece"
              hint="Nada é apagado: o cadastro fica inteiro, arquivado, e continua aparecendo na busca e no recorte “Arquivado”. Se a conversa voltar, é só criar o contrato dele. O motivo vai para a auditoria — é lá que ele serve depois."
            >
              {/* Sem type-to-confirm de propósito: isto não destrói dado
                  nenhum. A confirmação por digitação é o portão do que não tem
                  volta (anonimizar), e gastar esse peso aqui o desvaloriza lá. */}
              <Campo rotulo="Motivo" largo apoio="opcional — uma linha basta">
                <input
                  name="reason"
                  placeholder="ex.: achou caro; foi para outra escola; sumiu"
                  className={CAMPO}
                />
              </Campo>
            </SheetSection>
          </SheetBody>
          <Rodape voltarPara={self} acao="Marcar como perdido" />
        </FormValidado>
      </PainelDeUrl>
    )
  }

  /* ------------------------------------------------------------- briefing */
  if (painel === 'briefing') {
    const respostas = ficha.briefing?.respostas ?? {}
    // A régua é a da LINHA (briefings.schema_version), como no portal: rascunho
    // começado no v1 termina no v1. Sem linha ainda, é o v2 — é o que o default
    // da coluna carimba no primeiro `admin_fill_briefing`. Era aqui o buraco
    // declarado no P2.2: o painel desenhava SEMPRE as telas v1 enquanto a action
    // já montava o jsonb pela régua da linha, então o preenchimento por telefone
    // de um aluno v2 gravava as chaves erradas.
    const versao = ficha.briefing?.versao ?? 2
    const kolbAtual = ficha.briefing?.kolb ?? {}
    const comResponsavel = versao >= 2 && ficha.tipo === 'child'
    return (
      <PainelDeUrl
        titulo={titulo}
        descricao={`Colhido por telefone com ${ficha.nome} — fica auditado como preenchimento da escola.`}
        voltarPara={self}
        bruto
      >
        <FormValidado action={adminFillBriefingAction} className="flex min-h-0 flex-1 flex-col">
          <input type="hidden" name="student_id" value={ficha.id} />
          <SheetBody>
            <SheetSection
              title="Como preencher"
              hint="Dá para salvar parcial (rascunho) e completar depois. Marque “finalizar” só com tudo respondido: o estilo Kolb é calculado no envio e as respostas travam."
            >
              {/* Os MESMOS campos compartilhados do portal (`BriefingFields`):
                  o que a dona preenche aqui tem de ser palavra por palavra o
                  que o aluno leria lá — inclusive o RAMO (criança não responde
                  pergunta de vida profissional). */}
              <CamposDaEtapa
                secao="historia"
                respostas={respostas}
                versao={versao}
                tipo={ficha.tipo}
              />
              <CamposDaEtapa
                secao="objetivos"
                respostas={respostas}
                versao={versao}
                tipo={ficha.tipo}
              />
              <CamposDaEtapa
                secao="interesses"
                respostas={respostas}
                versao={versao}
                tipo={ficha.tipo}
              />
              <CamposDaEtapa secao="rotina" respostas={respostas} versao={versao} tipo={ficha.tipo} />
              {/* A pré-carga do Kolb é o fix aprovado da spec: era `kolb={{}}`,
                  e reabrir o painel para completar o resto do briefing APAGAVA
                  as letras já respondidas (nenhum radio vinha marcado, e o
                  formulário reenvia tudo). */}
              <EtapaKolb kolb={kolbAtual} required={false} intro={false} notaResponsavel={comResponsavel} />
              <CamposDaEtapa secao="livre" respostas={respostas} versao={versao} tipo={ficha.tipo} />
              <label className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                <input type="checkbox" name="finalize" value="1" className="h-4 w-4 accent-ac-deep" />
                Finalizar (calcula o Kolb e trava as respostas)
              </label>
            </SheetSection>
          </SheetBody>
          <Rodape voltarPara={self} acao="Salvar briefing" />
        </FormValidado>
      </PainelDeUrl>
    )
  }

  /* --------------------------------------------------- correção do briefing */
  if (painel === 'briefing-correcao') {
    const b = ficha.briefing
    // Rascunho não se "corrige": edita-se direto (o painel `briefing`), e a RPC
    // recusa. Endereço digitado à mão volta para a ficha em vez de abrir um
    // formulário que só pode falhar — mesma régua de `estender` e `perder`.
    if (!b?.enviado) redirect(enderecoDaFicha(ficha.id, { aba: 'briefing' }))
    const voltarAqui = enderecoDaFicha(ficha.id, { aba: 'briefing' })
    const secao: SecaoBriefing | null = ehSecaoBriefing(alvo) ? alvo : null

    // Primeira página do assunto: QUAL etapa corrigir (mesmo desenho em duas
    // páginas do painel `pagador`). Não é um `<select>` de propósito: o painel é
    // renderizado no servidor e um seletor não navega sem JS — cada etapa é um
    // endereço, e o botão de voltar do navegador funciona.
    if (!secao) {
      return (
        <PainelDeUrl
          titulo={titulo}
          descricao={`${ficha.nome} — escolha a etapa que precisa mudar.`}
          voltarPara={voltarAqui}
          bruto
        >
          <SheetBody>
            <SheetSection
              title="Que etapa mudou?"
              hint="A correção fica registrada com motivo e o de/para de cada resposta. O teste de estilo (Kolb) não entra: é instrumento calibrado, e o banco recusa correção nele."
            >
              <div className="flex flex-col gap-2">
                {SECOES_DE_RESPOSTA.map((s) => (
                  <a
                    key={s.secao}
                    href={enderecoDaFicha(ficha.id, {
                      painel: 'briefing-correcao',
                      alvo: s.secao,
                    })}
                    className="btn-ac-soft self-start"
                  >
                    {s.titulo}
                  </a>
                ))}
              </div>
            </SheetSection>
          </SheetBody>
          <SheetFooter
            cancel={
              <a href={voltarAqui} className="btn-ac-soft btn-ac-lg">
                Voltar à ficha
              </a>
            }
          />
        </PainelDeUrl>
      )
    }

    const tituloDaSecao = SECOES_DE_RESPOSTA.find((s) => s.secao === secao)!.titulo
    return (
      <PainelDeUrl
        titulo={titulo}
        descricao={`${ficha.nome} · ${tituloDaSecao}`}
        voltarPara={voltarAqui}
        bruto
      >
        <FormValidado action={adminReviseBriefingAction} className="flex min-h-0 flex-1 flex-col">
          <input type="hidden" name="student_id" value={ficha.id} />
          <input type="hidden" name="secao" value={secao} />
          <SheetBody>
            <SheetSection
              title={tituloDaSecao}
              hint="Os campos vêm preenchidos com as respostas do briefing BASE (a correção não altera atualizações semestrais). Só o que você MUDAR entra na correção — o resto nem aparece no histórico."
            >
              <CamposDaEtapa
                secao={secao}
                respostas={b.respostas}
                versao={b.versao}
                tipo={ficha.tipo}
              />
            </SheetSection>
            <SheetSection
              title="Por que a correção"
              hint="Fica no histórico do aluno, ao lado do de/para. É o que explica, daqui a seis meses, por que a resposta enviada mudou."
            >
              <Campo
                rotulo="Motivo"
                largo
                apoio="obrigatório — o banco recusa sem ele"
                exigencia="Informe por que esta resposta mudou"
              >
                <input name="motivo" required placeholder="ex.: a aluna se mudou" className={CAMPO} />
              </Campo>
            </SheetSection>
          </SheetBody>
          <Rodape voltarPara={voltarAqui} acao="Salvar correção" />
        </FormValidado>
      </PainelDeUrl>
    )
  }

  /* ------------------------------------------------------------- estender */
  if (painel === 'estender') {
    const credito = ficha.creditos.vivos.find((c) => String(c.ledgerId) === alvo)
    // S1: sem alvo, ou com alvo que NÃO se estende (vencido / sem prazo), o
    // painel não abre. Quem recusa de verdade é a RPC; isto é o endereço
    // digitado à mão não virando um formulário que só pode falhar.
    if (!credito || !credito.extensivel) redirect(enderecoDaFicha(ficha.id, { aba: 'creditos' }))
    return (
      <PainelDeUrl
        titulo={titulo}
        descricao={`${ficha.nome} · crédito que vale até ${credito.validade}`}
        voltarPara={enderecoDaFicha(ficha.id, { aba: 'creditos' })}
        bruto
      >
        <FormValidado action={extendCreditAction} className="flex min-h-0 flex-1 flex-col">
          <input type="hidden" name="ledger_id" value={credito.ledgerId} />
          <input type="hidden" name="back" value={enderecoDaFicha(ficha.id, { aba: 'creditos' })} />
          <SheetBody>
            <SheetSection
              title="Nova validade"
              hint="O banco lança o par −1/+1 (Lei 2: ledger append-only): o crédito continua com a mesma duração e a mesma origem, só a data muda. Estender só empurra para FRENTE — data anterior à atual o banco recusa."
            >
              <GradeDeCampos>
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-semibold text-ink-900">Vale hoje até</span>
                  <p className="py-2 text-sm text-ink-900">{credito.validade}</p>
                </div>
                <Campo
                  rotulo="Passa a valer até"
                  apoio={`de ${credito.minimaNovaValidade} em diante`}
                  exigencia="Informe a nova data de validade"
                >
                  <DateField
                    name="new_expires_on"
                    required
                    min={credito.minimaNovaValidadeIso}
                    className={CAMPO}
                  />
                </Campo>
                <Campo
                  rotulo="Motivo"
                  apoio="obrigatório — fica na auditoria"
                  exigencia="Informe o motivo da extensão"
                >
                  <input name="note" required placeholder="ex.: viagem do aluno" className={CAMPO} />
                </Campo>
              </GradeDeCampos>
            </SheetSection>
          </SheetBody>
          <Rodape voltarPara={enderecoDaFicha(ficha.id, { aba: 'creditos' })} acao="Estender" />
        </FormValidado>
      </PainelDeUrl>
    )
  }

  /* ------------------------------------------------------------- cancelar */
  const aula = ficha.aulas.proximas.find((a) => a.id === alvo)
  if (!aula) redirect(enderecoDaFicha(ficha.id, { aba: 'historico' }))
  const voltar = enderecoDaFicha(ficha.id, { aba: 'historico' })
  return (
    <PainelDeUrl
      titulo={titulo}
      descricao={`${ficha.nome} · ${aula.instante.texto}`}
      voltarPara={voltar}
      bruto
    >
      <FormValidado action={cancelClassAction} className="flex min-h-0 flex-1 flex-col">
        <input type="hidden" name="instance_id" value={aula.id} />
        <input type="hidden" name="back" value={voltar} />
        {/* A6/lote 2: o corpo e o rodapé deste painel viraram peça CLIENTE —
            a consequência mostrada na confirmação depende de quem pediu o
            cancelamento, escolhido aqui mesmo. A entregabilidade do aviso sai
            do que a ficha JÁ sabe: `students.profile_id` (que é o `temLogin`)
            e o número do perfil.

            …E SÓ QUANDO A AULA É DELE SOZINHO (A6, prova independente L2 —
            grave). As próximas aulas desta ficha incluem as do contrato de
            GRUPO (casal/turma), e ali o aviso é enfileirado POR MEMBRO: usar o
            cadastro do aluno da ficha fazia as duas caixas nascerem
            desmarcadas por causa DELE — e um toque em confirmar silenciava o
            aviso de TODOS. Aula de grupo passa `null/null`, a mesma semântica
            da Agenda (caixas ligadas + `GRUPO_ENTREGA_POR_MEMBRO`). */}
        <CancelarAula
          voltar={voltar}
          agoraNoNegocio={ficha.agoraNoNegocio}
          digitado={digitado}
          entregabilidade={
            aula.ehGrupo
              ? { temLogin: null, temWhatsapp: null }
              : { temLogin: ficha.temLogin, temWhatsapp: Boolean(ficha.whatsapp) }
          }
        />
      </FormValidado>
    </PainelDeUrl>
  )
}
