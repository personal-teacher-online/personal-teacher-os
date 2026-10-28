// NOVO LEAD (ciclo de vida, fase 1 — 27/07/2026): o cadastro mínimo de quem
// conversou com a escola e ainda não fechou.
//
// TRÊS CAMPOS, um obrigatório. É de propósito: o gesto acontece com o WhatsApp
// aberto, no meio da conversa, e um formulário que exige fuso, nível e plano
// nessa hora é um formulário que ninguém preenche — a prospecção volta para a
// planilha, que é o que esta fase veio matar. O que faltar entra depois, pela
// ficha; o que a admissão exige, o wizard continua exigindo (o lead vira aluno
// quando o contrato nasce, e aí sim tudo é obrigatório).
//
// Corpo renderizado no SERVIDOR dentro do Sheet do hub (`?lead=1`), na mesma
// anatomia dos painéis da ficha: `FormValidado` (erro em português, embaixo do
// campo), `SheetBody` que rola e rodapé FIXO [Cancelar | Criar lead].

import Link from 'next/link'

import { CityPicker } from '@/components/CityPicker'
import { FormValidado } from '@/components/kit/form-validado'
import { SheetBody, SheetFooter, SheetSection } from '@/components/kit/sheet'
import { CAMPO, Campo, GradeDeCampos } from './ficha/pecas'
import { createLeadAction } from '@/app/admin/alunos/actions'

export function FormularioDeLead() {
  return (
    <FormValidado action={createLeadAction} className="flex min-h-0 flex-1 flex-col">
      <SheetBody>
        <SheetSection
          title="Quem é"
          hint="Lead não recebe convite nem tem portal: ele existe só aqui dentro, na sua lista, até virar contrato."
        >
          <GradeDeCampos>
            <Campo rotulo="Nome" largo exigencia="Informe o nome do lead">
              <input
                name="display_name"
                required
                placeholder="ex.: Mariana Alves"
                className={CAMPO}
              />
            </Campo>
            {/* Cidade OPCIONAL — e é o mesmo CityPicker do cadastro de aluno,
                que grava cidade, país e fuso IANA juntos (Lei 1: ninguém digita
                "America/…"). Sem cidade, o banco assume o fuso do NEGÓCIO e a
                ficha corrige no dia em que a informação aparecer. */}
            <Campo
              rotulo="Cidade"
              largo
              apoio="opcional — sem ela, o fuso assumido é o da escola (Cuiabá)"
            >
              <CityPicker tzName="iana_tz" cityName="city" countryName="country" />
            </Campo>
            <Campo rotulo="Como conheceu a escola" largo apoio="opcional">
              <input
                name="referral_source"
                placeholder="ex.: indicação da Mariana, Instagram"
                className={CAMPO}
              />
            </Campo>
          </GradeDeCampos>
        </SheetSection>
      </SheetBody>
      <SheetFooter
        cancel={
          // Cancelar é NAVEGAÇÃO de volta à lista — âncora de verdade (teclado,
          // meio-clique), com CARA DE BOTÃO: ação de rodapé é botão, nunca
          // link-texto (régua do M3-c4 · B4).
          <Link href="/admin/alunos" className="btn-ac-soft btn-ac-lg">
            Cancelar
          </Link>
        }
      >
        <button type="submit" className="btn-ac btn-ac-lg">
          Criar lead
        </button>
      </SheetFooter>
    </FormValidado>
  )
}
