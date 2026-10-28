// Cronograma M0c (20/07/2026) — os CAMPOS do briefing como peças reusáveis
// (server-safe, zero client JS): o portal monta as 6 etapas com salvamento
// parcial; a retaguarda da dona monta TUDO empilhado num painel só
// (admin_fill_briefing). Fonte única dos textos: src/lib/briefing/schema.ts.
import type { ReactNode } from 'react'
import { input } from '@/components/ui'
import {
  CONTATO_OPCOES,
  CORRECAO_OPCOES,
  FINALIDADES_OPCOES,
  FINALIDADE_PROFISSIONAL,
  HOBBIES,
  HOBBIES_MIN,
  IMERSAO_OPCOES,
  INTERCAMBIO_OPCOES,
  KOLB_QUESTIONS,
  ONDE_TRAVA_OPCOES,
  PARA_QUE_INGLES_OPCOES,
  ROTINA_BLOCOS,
  ROTINA_DIAS,
  SIM_NAO,
  TEMPO_DIARIO_OPCOES,
  TOPICOS_PROFISSIONAIS_CAMPOS,
  TOPICOS_PROFISSIONAIS_MIN,
  VIAGEM_OPCOES,
  enunciadoDaChave,
  type TipoAluno,
  type VersaoBriefing,
} from '@/lib/briefing/schema'

const areaTxt = `${input} min-h-24 w-full`

export function CampoBriefing({
  label,
  apoio,
  children,
}: {
  label: string
  apoio?: string
  children: ReactNode
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold text-ink-900">{label}</span>
      {apoio && <span className="text-xs text-ink-400">{apoio}</span>}
      {children}
    </label>
  )
}

export type BriefingAnswers = Record<string, Record<string, unknown>>

export function EtapaHistoria({ a, required = true }: { a: BriefingAnswers; required?: boolean }) {
  const h = (a.historia ?? {}) as Record<string, string>
  return (
    <>
      <CampoBriefing label="Em que cidade passou a maior parte da sua vida?">
        <input name="cidade_vida" required={required} defaultValue={h.cidade_vida ?? ''} className={input} />
      </CampoBriefing>
      <CampoBriefing label="O que você acha mais fácil na língua inglesa? E qual é a sua maior dificuldade?">
        <textarea name="facil_dificil" required={required} defaultValue={h.facil_dificil ?? ''} className={areaTxt} />
      </CampoBriefing>
      <CampoBriefing label="Conte como foi seu contato com o inglês até hoje. Já fez aulas particulares ou em grupo antes? Já fez intercâmbio ou morou fora? Teve alguma experiência marcante com o idioma?">
        <textarea name="contato" required={required} defaultValue={h.contato ?? ''} className={areaTxt} />
      </CampoBriefing>
    </>
  )
}

export function EtapaObjetivos({ a, required = true }: { a: BriefingAnswers; required?: boolean }) {
  const o = (a.objetivos ?? {}) as Record<string, string>
  return (
    <>
      <CampoBriefing label="Para quais finalidades você quer praticar a conversação? (ex.: trabalho, viagens, imigração, entender filmes/séries, amizades, etc.)">
        <textarea name="finalidades" required={required} defaultValue={o.finalidades ?? ''} className={areaTxt} />
      </CampoBriefing>
      <CampoBriefing label="Descreva pelo menos 6 tópicos de sua vida profissional para os quais você precisa aprender vocabulário em inglês. (ex: reuniões, emails, apresentações, atendimento ao cliente, conferências, etc.)">
        <textarea name="topicos_profissionais" required={required} defaultValue={o.topicos_profissionais ?? ''} className={areaTxt} />
      </CampoBriefing>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold text-ink-900">
          Você já realizou alguma viagem internacional e/ou planeja realizar em breve?
        </legend>
        {VIAGEM_OPCOES.map((op) => (
          <label key={op} className="flex items-start gap-2 text-sm text-ink-600">
            <input type="radio" name="viagem" value={op} required={required} defaultChecked={o.viagem === op} className="mt-1 accent-(--brand-700)" />
            {op}
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold text-ink-900">
          Você tem interesse em fazer um intercâmbio ou teste de proficiência em inglês?
        </legend>
        {INTERCAMBIO_OPCOES.map((op) => (
          <label key={op} className="flex items-start gap-2 text-sm text-ink-600">
            <input type="radio" name="intercambio" value={op} required={required} defaultChecked={o.intercambio === op} className="mt-1 accent-(--brand-700)" />
            {op}
          </label>
        ))}
      </fieldset>
    </>
  )
}

/** A grade de 18 hobbies + "Outro" — a MESMA peça no v1 e no v2 (etapa 3 mantida). */
function GradeDeHobbies({ hobbies }: { hobbies: string[] }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-semibold text-ink-900">
        Escolha pelo menos {HOBBIES_MIN} coisas que você gosta de fazer em seu tempo livre
      </legend>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {HOBBIES.map((hb) => (
          <label key={hb} className="flex items-start gap-2 text-sm text-ink-600">
            <input type="checkbox" name="hobbies" value={hb} defaultChecked={hobbies.includes(hb)} className="mt-1 accent-(--brand-700)" />
            {hb}
          </label>
        ))}
      </div>
      <label className="mt-1 flex items-center gap-2 text-sm text-ink-600">
        Outro:
        <input name="hobby_outro" defaultValue={hobbies.find((x) => x.startsWith('Outro: '))?.slice(7) ?? ''} className={`${input} flex-1`} />
      </label>
    </fieldset>
  )
}

export function EtapaInteresses({ a, required = true }: { a: BriefingAnswers; required?: boolean }) {
  const i = (a.interesses ?? {}) as { hobbies?: string[]; leitura?: string; filmes_series?: string; musicas?: string }
  return (
    <>
      <GradeDeHobbies hobbies={i.hobbies ?? []} />
      <CampoBriefing label="Você gosta de ler? Quais são os seus autores/blogs/sites favoritos?">
        <textarea name="leitura" required={required} defaultValue={i.leitura ?? ''} className={areaTxt} />
      </CampoBriefing>
      <CampoBriefing label="Você prefere filmes ou séries? De quais gêneros você mais gosta?">
        <textarea name="filmes_series" required={required} defaultValue={i.filmes_series ?? ''} className={areaTxt} />
      </CampoBriefing>
      <CampoBriefing label="Você gosta de músicas em inglês?">
        <textarea name="musicas" required={required} defaultValue={i.musicas ?? ''} className={areaTxt} />
      </CampoBriefing>
    </>
  )
}

export function EtapaRotina({ a, required = true }: { a: BriefingAnswers; required?: boolean }) {
  const r = (a.rotina ?? {}) as { blocos?: Record<string, string[]>; imersao?: string }
  return (
    <>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold text-ink-900">
          Em quais momentos da semana você costuma ter um tempo para o inglês?
        </legend>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-separate border-spacing-0 text-center text-xs">
            <thead>
              <tr>
                <th className="p-1 text-left font-semibold text-ink-400"> </th>
                {ROTINA_DIAS.map((dd) => (
                  <th key={dd} className="p-1 font-semibold tracking-wide text-ink-400 uppercase">{dd}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROTINA_BLOCOS.map((bl) => (
                <tr key={bl}>
                  <td className="p-1 text-left text-sm whitespace-nowrap text-ink-600">{bl}</td>
                  {ROTINA_DIAS.map((dd) => (
                    <td key={dd} className="p-1">
                      <input
                        type="checkbox"
                        name="blocos"
                        value={`${dd}|${bl}`}
                        defaultChecked={(r.blocos?.[dd] ?? []).includes(bl)}
                        className="h-4 w-4 accent-(--brand-700)"
                        aria-label={`${bl} de ${dd}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold text-ink-900">
          Qual imersão semanal combina mais com você?
        </legend>
        {IMERSAO_OPCOES.map((op) => (
          <label key={op} className="flex items-start gap-2 text-sm text-ink-600">
            <input type="radio" name="imersao" value={op} required={required} defaultChecked={r.imersao === op} className="mt-1 accent-(--brand-700)" />
            {op}
          </label>
        ))}
        <label className="flex items-center gap-2 text-sm text-ink-600">
          <input type="radio" name="imersao" value="outra" defaultChecked={(r.imersao ?? '').startsWith('Outra: ')} className="accent-(--brand-700)" />
          Outra:
          <input name="imersao_outra" defaultValue={(r.imersao ?? '').startsWith('Outra: ') ? r.imersao!.slice(7) : ''} className={`${input} flex-1`} />
        </label>
      </fieldset>
    </>
  )
}

export function EtapaKolb({
  kolb,
  required = true,
  intro = true,
  notaResponsavel = false,
}: {
  kolb: Record<string, string>
  required?: boolean
  intro?: boolean
  /** v2, ramo criança: o teste é do aluno, mas quem lê as alternativas é adulto. */
  notaResponsavel?: boolean
}) {
  return (
    <>
      {intro && (
        <p className="text-sm leading-relaxed text-ink-600">
          Não existe resposta certa — escolha a alternativa que mais parece com você. O resultado
          ajuda a sua professora a montar aulas do seu jeito de aprender.
        </p>
      )}
      {notaResponsavel && (
        <p className="text-sm leading-relaxed font-semibold text-ink-900">
          Responda esta etapa junto com o responsável: leiam as alternativas em voz alta e escolham
          juntos a que mais parece com ele(a).
        </p>
      )}
      {KOLB_QUESTIONS.map((q, idx) => (
        <fieldset key={idx} className="flex flex-col gap-2 border-t border-line-soft pt-4">
          <legend className="text-sm font-semibold text-ink-900">
            {idx + 1}. {q.enunciado}
          </legend>
          {q.opcoes.map((op) => (
            <label key={op.letra} className="flex items-start gap-2 text-sm text-ink-600">
              <input
                type="radio"
                name={`q${idx + 1}`}
                value={op.letra}
                required={required}
                defaultChecked={kolb[`q${idx + 1}`] === op.letra}
                className="mt-1 accent-(--brand-700)"
              />
              {op.texto}
            </label>
          ))}
        </fieldset>
      ))}
    </>
  )
}

/* ==========================================================================
 * BRIEFING v2 (spec aprovada em docs/goals/briefing-v2.md, 28/07/2026)
 *
 * As etapas 1/2/3 ganharam variante v2 e a 2 ramifica por `students.student_type`
 * (criança não responde pergunta de vida profissional). Etapas 4 (rotina) e 5
 * (Kolb) são as MESMAS peças do v1 — a spec as manteve intocadas.
 *
 * Regra desta seção: NENHUM enunciado é escrito aqui. Toda pergunta vem do
 * dicionário (`enunciadoDaChave`), que é a mesma fonte que a ficha da admin usa
 * para ler a resposta de volta — pergunta e leitura não podem divergir.
 * ========================================================================== */

/** O enunciado da chave na régua do v2. */
const rot = (chave: string) => enunciadoDaChave(chave, 2)

function textoDe(secao: Record<string, unknown>, chave: string): string {
  const v = secao[chave]
  return typeof v === 'string' ? v : ''
}

function listaDe(secao: Record<string, unknown>, chave: string): string[] {
  const v = secao[chave]
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/**
 * Múltipla escolha e escolha única do v2, com o enunciado vindo do dicionário.
 * `required` só vale para RADIO: num grupo de checkbox o atributo exigiria TODAS
 * marcadas, então o mínimo (≥1) é antecipado pela action e cobrado pelo banco.
 */
function Escolhas({
  chave,
  opcoes,
  marcadas,
  multipla = false,
  required = true,
  apoio,
}: {
  chave: string
  opcoes: readonly string[]
  marcadas: string[]
  multipla?: boolean
  required?: boolean
  apoio?: string
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-semibold text-ink-900">{rot(chave)}</legend>
      {apoio && <p className="text-xs text-ink-400">{apoio}</p>}
      {opcoes.map((op) => (
        <label key={op} className="flex items-start gap-2 text-sm text-ink-600">
          <input
            type={multipla ? 'checkbox' : 'radio'}
            name={chave}
            value={op}
            required={required && !multipla}
            defaultChecked={marcadas.includes(op)}
            className="mt-1 accent-(--brand-700)"
          />
          {op}
        </label>
      ))}
    </fieldset>
  )
}

export function EtapaHistoriaV2({ a, required = true }: { a: BriefingAnswers; required?: boolean }) {
  const h = (a.historia ?? {}) as Record<string, unknown>
  return (
    <>
      <CampoBriefing label={rot('cidade_vida')}>
        <input name="cidade_vida" required={required} defaultValue={textoDe(h, 'cidade_vida')} className={input} />
      </CampoBriefing>
      <CampoBriefing label={rot('facil')}>
        <textarea name="facil" required={required} defaultValue={textoDe(h, 'facil')} className={areaTxt} />
      </CampoBriefing>
      <CampoBriefing label={rot('dificil')}>
        <textarea name="dificil" required={required} defaultValue={textoDe(h, 'dificil')} className={areaTxt} />
      </CampoBriefing>
      <Escolhas chave="contato" opcoes={CONTATO_OPCOES} marcadas={listaDe(h, 'contato')} multipla />
      <CampoBriefing label={rot('experiencia_marcante')} apoio="opcional">
        <textarea name="experiencia_marcante" defaultValue={textoDe(h, 'experiencia_marcante')} className={areaTxt} />
      </CampoBriefing>
    </>
  )
}

export function EtapaObjetivosV2({
  a,
  tipo,
  required = true,
}: {
  a: BriefingAnswers
  tipo: TipoAluno
  required?: boolean
}) {
  const o = (a.objetivos ?? {}) as Record<string, unknown>

  if (tipo === 'child') {
    return (
      <>
        <Escolhas
          chave="para_que_ingles"
          opcoes={PARA_QUE_INGLES_OPCOES}
          marcadas={listaDe(o, 'para_que_ingles')}
          multipla
        />
        <CampoBriefing label={rot('temas_escola')}>
          <input name="temas_escola" required={required} defaultValue={textoDe(o, 'temas_escola')} className={input} />
        </CampoBriefing>
        <CampoBriefing label={rot('favoritos_midia')}>
          <textarea name="favoritos_midia" required={required} defaultValue={textoDe(o, 'favoritos_midia')} className={areaTxt} />
        </CampoBriefing>
        <CampoBriefing label={rot('quem_acompanha')}>
          <input name="quem_acompanha" required={required} defaultValue={textoDe(o, 'quem_acompanha')} className={input} />
        </CampoBriefing>
        <CampoBriefing label={rot('temperamento')}>
          <textarea name="temperamento" required={required} defaultValue={textoDe(o, 'temperamento')} className={areaTxt} />
        </CampoBriefing>
      </>
    )
  }

  const topicos = listaDe(o, 'topicos_profissionais')
  return (
    <>
      <Escolhas chave="finalidades" opcoes={FINALIDADES_OPCOES} marcadas={listaDe(o, 'finalidades')} multipla />
      <Escolhas
        chave="finalidade_principal"
        opcoes={FINALIDADES_OPCOES}
        marcadas={[textoDe(o, 'finalidade_principal')]}
        required={required}
        apoio="escolha UMA — precisa ser uma das que você marcou acima"
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold text-ink-900">{rot('topicos_profissionais')}</legend>
        <p className="text-xs text-ink-400">
          {`só se você marcou “${FINALIDADE_PROFISSIONAL}” — nesse caso, preencha pelo menos ${TOPICOS_PROFISSIONAIS_MIN}`}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {Array.from({ length: TOPICOS_PROFISSIONAIS_CAMPOS }, (_, idx) => (
            <input
              key={idx}
              name={`topico_${idx + 1}`}
              defaultValue={topicos[idx] ?? ''}
              className={input}
              aria-label={`Tópico profissional ${idx + 1}`}
            />
          ))}
        </div>
      </fieldset>
      <CampoBriefing label={rot('alvo_6_meses')}>
        <textarea name="alvo_6_meses" required={required} defaultValue={textoDe(o, 'alvo_6_meses')} className={areaTxt} />
      </CampoBriefing>
      <Escolhas chave="onde_trava" opcoes={ONDE_TRAVA_OPCOES} marcadas={listaDe(o, 'onde_trava')} multipla />
      <Escolhas
        chave="correcao_preferida"
        opcoes={CORRECAO_OPCOES}
        marcadas={[textoDe(o, 'correcao_preferida')]}
        required={required}
      />
      <Escolhas
        chave="tempo_diario"
        opcoes={TEMPO_DIARIO_OPCOES}
        marcadas={[textoDe(o, 'tempo_diario')]}
        required={required}
      />
      {/* SEM `required` (achado 8 da revisão de integração): o banco não cobra
          viagem nem intercâmbio no envio v2 (`_briefing_validate_v2_secoes` não
          as menciona), e `faltaNaEtapa` também não. Marcá-las obrigatórias no
          HTML deixaria a UI mais estrita que a regra — e a regra é do Postgres
          (Lei 3), com a tela só antecipando o que ele diria.
          ⚠️ `required={false}` EXPLÍCITO, e não a ausência da prop: `Escolhas`
          tem `required = true` por default, então omitir a prop marcava as duas
          como obrigatórias e o navegador BARRAVA a etapa 2 — o comentário acima
          descrevia uma intenção que o código não cumpria (regresso medido pelo
          harness e2e do P7a). Quem trava isso agora é
          `tests/briefing-v2-required-dom.test.ts`, não este comentário. */}
      <Escolhas
        chave="viagem"
        opcoes={VIAGEM_OPCOES}
        marcadas={[textoDe(o, 'viagem')]}
        required={false}
      />
      <Escolhas
        chave="intercambio"
        opcoes={INTERCAMBIO_OPCOES}
        marcadas={[textoDe(o, 'intercambio')]}
        required={false}
      />
    </>
  )
}

export function EtapaInteressesV2({ a, required = true }: { a: BriefingAnswers; required?: boolean }) {
  const i = (a.interesses ?? {}) as Record<string, unknown>
  return (
    <>
      <GradeDeHobbies hobbies={listaDe(i, 'hobbies')} />
      {['leitura', 'filmes_series', 'musicas'].map((chave) => (
        <div key={chave} className="flex flex-col gap-2">
          <Escolhas chave={chave} opcoes={SIM_NAO} marcadas={[textoDe(i, chave)]} required={required} />
          {/* O detalhe fica sempre visível (zero JS de cliente): quem respondeu
              "não" deixa em branco, quem respondeu "sim" preenche — e é o banco
              que recusa o "sim" sem detalhe. */}
          <CampoBriefing label={rot(`${chave}_detalhe`)}>
            <input name={`${chave}_detalhe`} defaultValue={textoDe(i, `${chave}_detalhe`)} className={input} />
          </CampoBriefing>
        </div>
      ))}
    </>
  )
}

/** Etapa 6 — as duas perguntas de fechamento, ambas OPCIONAIS (v2 acrescenta "apoio"). */
export function EtapaFechar({ a, versao }: { a: BriefingAnswers; versao: VersaoBriefing }) {
  const l = (a.livre ?? {}) as Record<string, unknown>
  return (
    <>
      <CampoBriefing label={enunciadoDaChave('obs', versao)} apoio="opcional">
        <textarea name="obs" defaultValue={textoDe(l, 'obs')} className={areaTxt} />
      </CampoBriefing>
      {versao >= 2 && (
        <CampoBriefing label={rot('apoio')} apoio="opcional">
          <textarea name="apoio" defaultValue={textoDe(l, 'apoio')} className={areaTxt} />
        </CampoBriefing>
      )}
    </>
  )
}
