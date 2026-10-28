// OS PAINÉIS DA PAUTA (frente de conteúdo · M4) — cadastrar e editar um criador
// de referência, no Sheet do kit com o rodapé fixo da anatomia medida.
//
// AS REGRAS QUE ESTE ARQUIVO CARREGA (as mesmas dos painéis do contrato):
// 1. O PAINEL É ENDEREÇO (`?painel=novo` · `?painel=editar&alvo=…`): sobrevive
//    ao F5, ao voltar do navegador e ao link colado.
// 2. SUCESSO E FALHA TÊM DESTINOS DIFERENTES: todo formulário leva `back` (a
//    lista limpa, quando dá certo) e `back_erro` (este mesmo painel, quando não
//    dá) — senão a recusa devolveria a lista com um toast vermelho e sem lugar
//    onde consertar.
// 3. ENDEREÇO QUE SÓ PODE FALHAR NÃO VIRA FORMULÁRIO: `?painel=editar` com alvo
//    que não existe devolve para a lista (quem faz isso é a página).
// 4. Nada de `<select>` nativo: quem escolhe entre poucos é RÁDIO — o mesmo
//    padrão do bloco de política dos Ajustes.
//
// ⚠️ AS MÉTRICAS APARECEM EM LEITURA, e não por delicadeza: a admin não tem
// grant de UPDATE nessas colunas (migration 20260801000100). Campo editável ali
// seria um formulário que o banco recusa — a tela diz de quem é o trabalho.
//
// Server-safe: só `PainelDeUrl` e `FormValidado` são clientes, e ambos recebem
// este conteúdo já renderizado no servidor.

import { TriangleAlert } from 'lucide-react'

import { CAMPO, Campo, GradeDeCampos } from '@/components/admin/alunos/ficha/pecas'
import { FormValidado } from '@/components/kit/form-validado'
import { PainelDeUrl } from '@/components/kit/painel-de-url'
import { SheetBody, SheetFooter } from '@/components/kit/sheet'
import {
  CASA_DA_PAUTA,
  PAISES,
  PAIS_ROTULO,
  PLATAFORMAS,
  PLATAFORMA_ROTULO,
  TIERS,
  TIER_ROTULO,
  TIPOS,
  TIPO_ROTULO,
  chaveDoCriador,
  enderecoDoPainel,
  type PainelDaPauta,
} from '@/data/admin/pauta-gramatica'
import type { CriadorDaPauta } from '@/data/admin/pauta'
import { createCreatorAction, setCreatorAtivoAction, updateCreatorAction } from '@/app/admin/conteudo/pauta/actions'

/** Os campos que voltam preenchidos depois de uma recusa. */
const MANTER = 'plataforma,handle,nome,pais,tipo,tier,notas'

type Rascunho = Record<string, string>

/** Grupo de rádios com a anatomia do bloco de política (Ajustes · A8). */
function EscolhaEmRadio({
  nome,
  rotulo,
  opcoes,
  escolhido,
  exigencia,
  largo,
}: {
  nome: string
  rotulo: string
  opcoes: { valor: string; rotulo: string }[]
  escolhido: string
  /** a frase quando ninguém foi escolhido (o `Campo` do kit chama assim) */
  exigencia: string
  largo?: boolean
}) {
  return (
    // `data-slot="campo"` para o `FormValidado` ter ONDE acender o erro — sem
    // ele o grupo ficaria `aria-invalid` sem frase nenhuma, que é o médio 6 já
    // pago no bloco de política dos Ajustes. Enviar sem escolher tem de DIZER o
    // que falta, não só pintar a borda.
    <div
      data-slot="campo"
      className={largo ? 'flex flex-col gap-1.5 sm:col-span-2' : 'flex flex-col gap-1.5'}
    >
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-semibold text-ink-900">{rotulo}</legend>
        <div className="flex flex-wrap gap-2 pt-1.5">
          {opcoes.map((op) => (
            <label
              key={op.valor}
              className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-input border border-line px-3 py-2 text-sm font-medium text-ink-900 transition-colors duration-(--duration-hover) ease-(--ease-in-out) hover:bg-paper-100 has-checked:border-ac-deep has-checked:bg-ac-wash"
            >
              <input
                type="radio"
                name={nome}
                value={op.valor}
                required
                defaultChecked={escolhido === op.valor}
                className="h-4 w-4 shrink-0 accent-[var(--ac-deep)]"
              />
              {op.rotulo}
            </label>
          ))}
        </div>
      </fieldset>
      <p
        data-slot="campo-erro"
        data-exigencia={exigencia}
        role="alert"
        hidden
        className="flex items-start gap-1.5 text-sm leading-relaxed text-danger-700"
      >
        <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
        <span data-slot="campo-erro-texto">{exigencia}</span>
      </p>
    </div>
  )
}

/** O corpo do formulário — o mesmo nos dois painéis (mesmos nomes de campo). */
function CamposDoCriador({
  criador,
  rascunho,
}: {
  criador?: CriadorDaPauta
  rascunho: Rascunho
}) {
  const valor = (campo: keyof CriadorDaPauta & string, cru?: string | null) =>
    rascunho[campo] ?? cru ?? ''

  return (
    <GradeDeCampos>
      <EscolhaEmRadio
        nome="plataforma"
        rotulo="Plataforma"
        largo
        exigencia="Escolha a plataforma"
        escolhido={valor('plataforma', criador?.plataforma)}
        opcoes={PLATAFORMAS.map((p) => ({ valor: p, rotulo: PLATAFORMA_ROTULO[p] }))}
      />

      <Campo
        rotulo="@ do perfil"
        apoio="Só o nome de usuário — sem o @, sem link e sem espaços."
        exigencia="Informe o @ do perfil"
      >
        <input
          name="handle"
          required
          maxLength={80}
          placeholder="ex.: englishinbrazil"
          defaultValue={valor('handle', criador?.handle)}
          className={CAMPO}
        />
      </Campo>

      <Campo rotulo="Nome" exigencia="Informe o nome do criador">
        <input
          name="nome"
          required
          maxLength={120}
          placeholder="ex.: English in Brazil (Carina Fragozo)"
          defaultValue={valor('nome', criador?.nome)}
          className={CAMPO}
        />
      </Campo>

      <EscolhaEmRadio
        nome="pais"
        rotulo="Mercado"
        largo
        exigencia="Escolha Brasil ou Internacional"
        escolhido={valor('pais', criador?.pais)}
        opcoes={PAISES.map((p) => ({ valor: p, rotulo: PAIS_ROTULO[p] }))}
      />

      {/* Leva 1: quem é (pessoa ou marca). Criador vem pré-marcado porque é o
          default do banco — a escolha explícita continua sendo dela. */}
      <EscolhaEmRadio
        nome="tipo"
        rotulo="Tipo"
        largo
        exigencia="Escolha criador ou empresa"
        escolhido={valor('tipo', criador?.tipo ?? 'criador')}
        opcoes={TIPOS.map((t) => ({ valor: t, rotulo: TIPO_ROTULO[t] }))}
      />

      {/* "Sem classificação" é OPÇÃO, não ausência: classificar exige olhar a
          conta (zero palpite, régua do M4), e o vazio vira NULL no banco. */}
      <EscolhaEmRadio
        nome="tier"
        rotulo="Tier de alcance"
        largo
        exigencia="Escolha o tier — ou deixe sem classificação"
        escolhido={valor('tier', criador?.tier ?? '')}
        opcoes={[
          { valor: '', rotulo: 'Sem classificação' },
          ...TIERS.map((t) => ({ valor: t, rotulo: TIER_ROTULO[t] })),
        ]}
      />

      <Campo
        rotulo="Notas"
        largo
        apoio="Opcional: o que aprender com ele — registro, gancho, edição, ritmo."
      >
        <textarea
          name="notas"
          rows={3}
          maxLength={600}
          placeholder="ex.: abre sempre com a correção do erro, sem apresentação"
          defaultValue={valor('notas', criador?.notas)}
          className={`${CAMPO} min-h-24 resize-y`}
        />
      </Campo>
    </GradeDeCampos>
  )
}

function Rodape({ acao, extra }: { acao: string; extra?: React.ReactNode }) {
  return (
    <SheetFooter
      cancel={
        // Cancelar é NAVEGAÇÃO de volta à lista — âncora de verdade, que funciona
        // com teclado, meio-clique e sem JS.
        <a href={CASA_DA_PAUTA} className="btn-ac-soft btn-ac-lg">
          Cancelar
        </a>
      }
    >
      {extra}
      <button type="submit" className="btn-ac btn-ac-lg">
        {acao}
      </button>
    </SheetFooter>
  )
}

function PainelNovo({ rascunho }: { rascunho: Rascunho }) {
  return (
    <PainelDeUrl
      titulo="Novo criador"
      descricao="Quem entra aqui é quem o robô de pesquisa vai acompanhar."
      voltarPara={CASA_DA_PAUTA}
      bruto
    >
      <FormValidado action={createCreatorAction} className="flex min-h-0 flex-1 flex-col">
        <input type="hidden" name="back" value={CASA_DA_PAUTA} />
        <input type="hidden" name="back_erro" value={enderecoDoPainel('novo')} />
        <input type="hidden" name="rascunho" value={chaveDoCriador('novo')} />
        <input type="hidden" name="manter" value={MANTER} />
        <SheetBody>
          <CamposDoCriador rascunho={rascunho} />
        </SheetBody>
        <Rodape acao="Adicionar" />
      </FormValidado>
    </PainelDeUrl>
  )
}

function PainelEditar({ criador, rascunho }: { criador: CriadorDaPauta; rascunho: Rascunho }) {
  // O form do ativo/inativo vive FORA do formulário de edição (formulário dentro
  // de formulário não existe em HTML) e é alcançado pelo atributo `form` do
  // botão — assim o rodapé continua sendo um só.
  const formDoAtivo = 'pauta-ativo'

  return (
    <PainelDeUrl
      titulo={criador.nome}
      descricao={`@${criador.handle} · ${PLATAFORMA_ROTULO[criador.plataforma]}`}
      voltarPara={CASA_DA_PAUTA}
      bruto
    >
      <form id={formDoAtivo} action={setCreatorAtivoAction} className="hidden">
        <input type="hidden" name="alvo" value={criador.id} />
        <input type="hidden" name="ativo" value={criador.ativo ? 'false' : 'true'} />
        <input type="hidden" name="back" value={CASA_DA_PAUTA} />
        <input type="hidden" name="back_erro" value={enderecoDoPainel('editar', criador.id)} />
      </form>

      <FormValidado action={updateCreatorAction} className="flex min-h-0 flex-1 flex-col">
        <input type="hidden" name="alvo" value={criador.id} />
        <input type="hidden" name="back" value={CASA_DA_PAUTA} />
        <input type="hidden" name="back_erro" value={enderecoDoPainel('editar', criador.id)} />
        <input type="hidden" name="rascunho" value={chaveDoCriador(criador.id)} />
        <input type="hidden" name="manter" value={MANTER} />
        <SheetBody>
          <CamposDoCriador criador={criador} rascunho={rascunho} />

          <div className="mt-5 flex flex-col gap-1 border-t border-line-soft pt-4">
            <p className="text-sm font-semibold text-ink-900">Medição</p>
            {criador.medidoEmFrase ? (
              <p className="text-sm font-medium text-ink-900">
                {criador.resumoDaMedicao}{' '}
                <span className="text-sm font-normal text-ink-600">
                  · medido em {criador.medidoEmFrase}
                </span>
              </p>
            ) : (
              <p className="text-sm text-ink-600">
                Sem medição ainda — quem preenche estes números é o robô de pesquisa.
              </p>
            )}
          </div>
        </SheetBody>

        <Rodape
          acao="Salvar"
          extra={
            <button type="submit" form={formDoAtivo} className="btn-ac-soft btn-ac-lg">
              {criador.ativo ? 'Desativar' : 'Reativar'}
            </button>
          }
        />
      </FormValidado>
    </PainelDeUrl>
  )
}

export function PaineisDaPauta({
  painel,
  criador,
  rascunho,
}: {
  painel: PainelDaPauta
  /** já resolvido pela página; `undefined` no painel `novo` */
  criador?: CriadorDaPauta
  rascunho: Rascunho
}) {
  if (painel === 'novo') return <PainelNovo rascunho={rascunho} />
  if (painel === 'editar' && criador) return <PainelEditar criador={criador} rascunho={rascunho} />
  return null
}
