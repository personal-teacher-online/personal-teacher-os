// WIZARD DE ADMISSÃO (Onda 1 · M3-3) — o "Add New Student" do TutorBird,
// vestido com o nosso kit. Continua HOSPEDADO pelo hub (`?novo=1`) dentro do
// Sheet, e continua encadeando as MESMAS actions de sempre (item 10 do e2e):
// nada de mutação foi reescrito aqui — só a roupa.
//
// ANATOMIA MEDIDA (mapeamento-tutorbird-2.md, 3ª passada, "Add New Student"):
// · stepper de círculos numerados no topo, rótulo ao lado, ativo com anel do
//   acento e passo feito virando ✓;
// · corpo em SEÇÕES com hairline, cada uma dizendo o que faz antes de pedir o
//   dado, e campos em GRADE DE 2 COLUNAS alinhada — rótulo bold em cima,
//   "opcional"/consequência discreta embaixo (objeção nº 2 salva do dono);
// · sufixo/prefixo DENTRO do campo (R$ no valor, "min" na duração), como o
//   "Minutes" deles;
// · rodapé FIXO: [Cancelar] à esquerda, ghost + sólido h40 à direita;
// · confirmação final com check verde e os próximos passos como CARDS com
//   frase;
// · troca de passo em cross-fade curto (`.passo-fade`, 150 ms; reduced-motion
//   já cai para 0,01 ms pela regra universal do globals).
//
// O QUE MUDOU DE PROPÓSITO EM RELAÇÃO AO ORIGINAL: o rodapé deles tem
// [Previous]; o nosso tem [Pular esta etapa]. O porquê está em
// `src/data/admin/admissao.ts` — aqui cada etapa JÁ SALVA, então "voltar"
// duplicaria aluno/contrato em vez de desfazer. O gesto que existe de verdade
// (pular) subiu do link de 12px em cinza — proibido pela régua de
// legibilidade — para o lugar do rodapé.
//
// Zero query neste arquivo: quem lê é `getAdmissionContext`, na camada de
// dados. Zero `?msg=` produzido: quem fala é a action velha, e quem transforma
// o recado em toast é o `AvisoLegado` do hub.
import Link from 'next/link'
import { Check, IdCard, Mail, UserPlus } from 'lucide-react'
import type { ReactNode } from 'react'

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
import { Stepper } from '@/components/kit/stepper'
// As peças de formulário do M3-2 (grade de 2 colunas, rótulo bold, apoio
// embaixo) moram na pasta da ficha porque nasceram lá; são as mesmas do painel
// de editar cadastro, e é isso que faz os dois formulários parecerem um só.
import { CAMPO, Campo, GradeDeCampos } from '@/components/admin/alunos/ficha/pecas'
import {
  CONCLUSAO,
  ETAPAS_DA_ADMISSAO,
  enderecoDaAdmissao,
  etapaDaAdmissao,
  lerRascunhoDoContrato,
  type EtapaDaAdmissao,
} from '@/data/admin/admissao'
import { getAdmissionContext } from '@/data/admin/alunos'
import {
  NIVEIS_DO_CADASTRO,
  SEM_NIVEL_NO_FORM,
  TIPO_DE_ALUNO,
  TIPO_DE_ALUNO_APOIO,
  TIPO_PADRAO,
  enderecoDaFicha,
} from '@/data/admin/ficha-gramatica'
import { tzLabel } from '@/lib/format'
import { inviteStudentAction } from '../actions'
import { EtapaDoContrato } from './EtapaDoContrato'
import { wizardContractAction, wizardStudentAction } from './actions'

/* ========================================================================== */
/* Peças da moldura                                                            */
/* ========================================================================== */

/** As duas opções de tipo, na ordem em que a etapa 1 pergunta (M3-c5 · D1). */
const TIPOS_DO_WIZARD = ['adult', 'child'] as const

/**
 * O stepper desta admissão: a peça do KIT com os rótulos daqui.
 *
 * A anatomia (círculo numerado, ✓ no feito, anel do acento no atual, o respiro
 * do M3-c3 · A1) mudou de casa no M4-3 — `src/components/kit/stepper.tsx` —
 * porque agora dois wizards a desenham: este e o de contrato. Nem um pixel
 * mudou; o que existe aqui é o nome local que as três etapas já usavam.
 */
function Passos({ atual }: { atual: EtapaDaAdmissao }) {
  return <Stepper etapas={ETAPAS_DA_ADMISSAO} atual={atual} aria-label="Etapas do cadastro" />
}

/**
 * Rodapé fixo do painel: [sair] · [Pular esta etapa] [ação sólida h40].
 *
 * S5 da revisão nº 6 — o botão de sair CONTA A VERDADE. A etapa 1 já COMMITA
 * (o aluno nasce no banco antes da etapa 2 existir): a partir dali "Cancelar"
 * mentia, porque não havia nada a cancelar. Vira "Fechar", e a rede que torna o
 * abandono recuperável já existe: aluno sem contrato cai no balde "Sem contrato
 * ativo" do hub (`SEM_CONTRATO` em `src/data/admin/alunos-grupos.ts`), e a
 * ficha dele permite criar o contrato depois.
 *
 * M3-c4 · B4 — MAS COM CARA DE BOTÃO. O lote c2 tinha resolvido a honestidade
 * escrevendo a explicação DENTRO do rótulo ("Fechar — aluno já criado",
 * "Pular — contrato depois"), e o fantasma (`.btn-ac-ghost`: texto no acento,
 * sem borda nem fundo) devolveu ao rodapé exatamente o padrão que o dono já
 * baniu três vezes — link-texto periwinkle fazendo papel de ação. Duas
 * correções, e nenhuma delas apaga a verdade que o c2 acrescentou:
 *   · rótulo curto de BOTÃO ("Fechar", "Pular esta etapa"), com contorno
 *     (`.btn-ac-soft`), que é o que a anatomia do TutorBird mostra no rodapé;
 *   · a explicação (o aluno já está salvo; dá para fazer depois) desce para a
 *     PROSA da seção, que é onde prosa mora.
 */
function Rodape({
  pularPara,
  acao,
  alunoCriado,
}: {
  pularPara?: string
  acao: string
  /** true a partir da etapa 2: a etapa 1 já gravou o aluno */
  alunoCriado?: boolean
}) {
  return (
    <SheetFooter
      cancel={
        <Link href="/admin/alunos" className="btn-ac-soft btn-ac-lg">
          {alunoCriado ? 'Fechar' : 'Cancelar'}
        </Link>
      }
    >
      {pularPara && (
        <Link href={pularPara} className="btn-ac-soft btn-ac-lg">
          Pular esta etapa
        </Link>
      )}
      <button type="submit" className="btn-ac btn-ac-lg">
        {acao}
      </button>
    </SheetFooter>
  )
}

/* ========================================================================== */
/* O wizard                                                                    */
/* ========================================================================== */

export async function AdmissionWizard({
  s,
  aluno,
  rascunho,
}: {
  s?: string
  aluno?: string
  /** `?rasc=` — o que a etapa 2 tinha preenchido quando a criação falhou (nº 12) */
  rascunho?: string | string[]
}) {
  const { aluno: student, professoras, planos, ocupacao } = await getAdmissionContext(aluno)
  const etapa = etapaDaAdmissao(s, Boolean(student))

  /** O passo, embrulhado no cross-fade. `key` força o remonte: sem ele o React
   *  reaproveita o nó e a animação não recomeça na troca de etapa. */
  const passo = (conteudo: ReactNode) => (
    <div key={etapa} className="passo-fade flex min-h-0 flex-1 flex-col">
      {conteudo}
    </div>
  )

  /* ------------------------------------------------------- 1. dados do aluno */
  if (etapa === 1 || !student) {
    return passo(
      <FormValidado action={wizardStudentAction} className="flex min-h-0 flex-1 flex-col">
        <SheetBody>
          <Passos atual={1} />
          <SheetSection
            title="Quem é o aluno"
            hint="A cidade define o fuso: os horários das aulas convertem sozinhos, e o relógio dele aparece na lista."
          >
            <GradeDeCampos>
              <Campo rotulo="Nome completo" exigencia="Informe o nome completo">
                <input
                  name="display_name"
                  required
                  autoFocus
                  placeholder="Nome e sobrenome"
                  className={CAMPO}
                />
              </Campo>
              <Campo rotulo="Nível" para="nivel-do-novo-aluno" apoio="deixe em branco até a avaliação">
                <Select name="level" defaultValue={SEM_NIVEL_NO_FORM}>
                  <SelectTrigger id="nivel-do-novo-aluno" className="min-h-11 w-full">
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
              <Campo
                rotulo="Cidade do aluno"
                largo
                apoio="é ela que define o fuso horário"
                exigencia="Informe a cidade do aluno"
              >
                <CityPicker tzName="iana_tz" cityName="city" countryName="country" required />
              </Campo>
            </GradeDeCampos>
          </SheetSection>

          {/* M3-c5 · D1 — o que a dona pergunta e a ficha não guardava. Os três
              são OPCIONAIS de propósito (inclusive o nascimento de criança):
              nenhuma regra de negócio depende deles hoje, e exigir um dado que
              a pessoa ainda não tem só trava a admissão de um aluno real. */}
          <SheetSection
            title="Um pouco mais sobre ele"
            hint="Nada aqui é obrigatório — dá para completar depois, na ficha. O tipo muda com quem a escola fala no dia a dia; a origem é o que diz de onde vêm os alunos novos."
          >
            <GradeDeCampos>
              <Campo rotulo="Tipo de aluno" para="tipo-do-novo-aluno">
                {/* Radios, e não Select: são DUAS opções e cada uma carrega uma
                    frase de apoio — esconder isso atrás de um menu obrigaria a
                    abrir a lista para descobrir o que a escolha significa. */}
                <fieldset id="tipo-do-novo-aluno" className="flex flex-col gap-2">
                  <legend className="sr-only">Tipo de aluno</legend>
                  {TIPOS_DO_WIZARD.map((t) => (
                    <label
                      key={t}
                      className="flex items-start gap-2 text-sm leading-relaxed text-ink-900"
                    >
                      <input
                        type="radio"
                        name="student_type"
                        value={t}
                        defaultChecked={t === TIPO_PADRAO}
                        className="mt-1 h-4 w-4 accent-ac-deep"
                      />
                      <span>
                        <span className="font-medium">{TIPO_DE_ALUNO[t]}</span>{' '}
                        <span className="text-ink-600">— {TIPO_DE_ALUNO_APOIO[t]}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              </Campo>
              <Campo rotulo="Nascimento" apoio="opcional">
                <DateField name="birth_date" className={CAMPO} />
              </Campo>
              <Campo rotulo="Como conheceu a escola" apoio="opcional" largo>
                <input
                  name="referral_source"
                  placeholder="ex.: indicação da Mariana"
                  className={CAMPO}
                />
              </Campo>
            </GradeDeCampos>
          </SheetSection>
        </SheetBody>
        <Rodape acao="Criar e continuar" />
      </FormValidado>,
    )
  }

  /* -------------------------------------------------- 2. contrato e horários */
  // A etapa 2 é a única CLIENTE do wizard, e o motivo é o B5: mostrar o que a
  // professora já tem marcado (e travar o horário que conflita) exige reagir a
  // "quem" e "que dia" antes do envio. O stepper e o rodapé continuam sendo
  // desenhados aqui, no servidor, e descem como filhos.
  if (etapa === 2) {
    return passo(
      <EtapaDoContrato
        action={wizardContractAction}
        alunoId={student.id}
        alunoNome={student.display_name}
        // Lei 1: o rótulo do fuso sai formatado do SERVIDOR — a etapa cliente
        // não importa Luxon nem calcula hora nenhuma.
        fusoDoAluno={tzLabel(student.iana_tz)}
        professoras={professoras}
        planos={planos}
        ocupacao={ocupacao}
        // c12 · nº 12: a etapa volta COM o que a pessoa digitou quando a criação
        // atômica falhou. A leitura é aqui, no servidor, e é tolerante — `?rasc=`
        // torto vira `null` e a etapa nasce em branco, como sempre nasceu.
        rascunho={lerRascunhoDoContrato(rascunho)}
        passos={<Passos atual={2} />}
        rodape={
          <Rodape
            alunoCriado
            pularPara={enderecoDaAdmissao(3, student.id)}
            acao="Criar contrato e continuar"
          />
        }
      />,
    )
  }

  /* ------------------------------------------------------------- 3. convite */
  if (etapa === 3) {
    return passo(
      <FormValidado action={inviteStudentAction} className="flex min-h-0 flex-1 flex-col">
        <input type="hidden" name="student_id" value={student.id} />
        {/* O destino do recado (e só ele): convidar daqui termina na conclusão
            do wizard, não na lista. */}
        <input type="hidden" name="back" value={enderecoDaAdmissao(CONCLUSAO, student.id)} />
        <SheetBody>
          <Passos atual={3} />
          <SheetSection
            title="Para onde vai o convite"
            hint={`${student.display_name} recebe um e-mail com o link para criar a senha do portal. O WhatsApp entra aqui porque o contrato já prevê os avisos por lá — é para esse número que saem os lembretes de aula. Dá para convidar depois, pela ficha do aluno.`}
          >
            <GradeDeCampos>
              <Campo
                rotulo="E-mail do aluno"
                apoio="vira o login dele no portal"
                exigencia="Informe o e-mail do aluno"
              >
                <input
                  name="email"
                  type="email"
                  required
                  autoFocus
                  placeholder="ex.: aluno@exemplo.com"
                  className={CAMPO}
                />
              </Campo>
              {/* `para` (e não rótulo embrulhando o campo): o seletor de país é
                  um `<button>`, e um `<label>` que embrulha este campo rotula o
                  BOTÃO — era daí que vinha a lista de DDI que não fechava
                  (M3-c4 · B1). */}
              {/* Correção 28/07 (regra do dono): o número NÃO é opt-in do
                  portal — o contrato externo já autoriza os avisos, então ele
                  nasce aqui, com a professora, e o aluno só TROCA depois. Por
                  isso é obrigatório: convite sem número criaria acesso sem o
                  canal que o contrato promete. */}
              <Campo
                rotulo="WhatsApp"
                para="whatsapp-do-novo-aluno"
                apoio="é para cá que vão os lembretes; o aluno pode trocar no portal"
                exigencia="Informe o WhatsApp do aluno"
              >
                <CountryPhoneField id="whatsapp-do-novo-aluno" name="whatsapp_e164" required />
              </Campo>
            </GradeDeCampos>
          </SheetSection>
        </SheetBody>
        <Rodape
          alunoCriado
          pularPara={enderecoDaAdmissao(CONCLUSAO, student.id)}
          acao="Enviar convite"
        />
      </FormValidado>,
    )
  }

  /* ---------------------------------------------------------- 4. conclusão  */
  const proximos = [
    {
      icone: Mail,
      titulo: 'Convidar para o portal',
      frase: 'Se você pulou o convite, o e-mail com o link da senha sai daqui.',
      href: enderecoDaFicha(student.id, { painel: 'convidar' }),
    },
    {
      icone: IdCard,
      titulo: 'Abrir a ficha',
      frase: 'Contrato, horários, créditos, briefing e histórico do aluno, num lugar só.',
      href: enderecoDaFicha(student.id),
    },
    {
      icone: UserPlus,
      titulo: 'Cadastrar outro aluno',
      frase: 'Recomeça do primeiro passo, com o painel limpo.',
      href: enderecoDaAdmissao(1),
    },
  ]

  return passo(
    <>
      <SheetBody>
        <Passos atual={CONCLUSAO} />
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <span
            aria-hidden
            className="flex h-12 w-12 items-center justify-center rounded-full bg-ok-wash"
          >
            <Check className="h-6 w-6 text-ok-700" />
          </span>
          <p className="title-section text-ink-900">Aluno criado!</p>
          <p className="max-w-md text-sm leading-relaxed text-ink-600">
            {student.display_name} já aparece na lista de alunos. O que vem depois é opcional — dá
            para fazer agora ou quando você quiser.
          </p>
        </div>

        <SheetSection title="Próximos passos" hint="Nenhum deles é obrigatório para o aluno existir.">
          <div className="grid grid-cols-1 gap-3">
            {proximos.map(({ icone: Icone, titulo, frase, href }) => (
              <Link
                key={href}
                href={href}
                className="card-kpi card-kpi-interactive flex items-start gap-3 p-4"
              >
                <span
                  aria-hidden
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ac-tint"
                >
                  <Icone className="h-4 w-4 text-ac-deep" />
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold text-ink-900">{titulo}</span>
                  <span className="text-sm leading-relaxed text-ink-600">{frase}</span>
                </span>
              </Link>
            ))}
          </div>
        </SheetSection>
      </SheetBody>
      <SheetFooter>
        <Link href="/admin/alunos" className="btn-ac btn-ac-lg">
          Concluir
        </Link>
      </SheetFooter>
    </>,
  )
}
