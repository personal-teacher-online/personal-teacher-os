// IM-2 — quem é o provedor de imagem do projeto, em um lugar só.
//
// PADRÃO: Gemini / Nano Banana 2 (ADR-023, adendo de 22/07/2026). É o mesmo
// motor das 33 fotos já aprovadas nos módulos 5–7, e o único dos dois que não
// inventa texto dentro da imagem.
//
// A Higgsfield continua implementada e plugável — não como plano B abandonado,
// mas porque a carteira de API dela existe e o driver está testado. Se o Gemini
// cair, reprecificar ou recusar conteúdo, trocar de motor é trocar o nome aqui.
import { geminiConfigFromEnv, geminiProvider } from './gemini.ts'
import { higgsfieldConfigFromEnv, higgsfieldProvider } from './higgsfield.ts'
import type { ImageProvider } from './provider.ts'

export const PROVEDOR_PADRAO = 'gemini'

/**
 * Todos os provedores conhecidos, cada um já lendo a própria credencial.
 *
 * Um provedor sem credencial NÃO é omitido do mapa: ele existe e falha com
 * mensagem explícita quando usado. Omitir daria "provedor desconhecido", que
 * manda a professora caçar o problema errado.
 */
export function provedoresDeImagem(): Record<string, ImageProvider> {
  return {
    gemini: geminiProvider(geminiConfigFromEnv()),
    higgsfield: higgsfieldProvider(higgsfieldConfigFromEnv()),
  }
}

export function provedorDeImagem(nome: string = PROVEDOR_PADRAO): ImageProvider | null {
  return provedoresDeImagem()[nome] ?? null
}
