import type { Metadata } from "next";
import { Suspense } from "react";
import { Inter, JetBrains_Mono, Roboto } from "next/font/google";
import { ClickFeedback } from "@/components/ClickFeedback";
import "./globals.css";

// FONTE DO SITE INTEIRO — **Inter** (rodada de clonagem TutorBird, 26/07/2026).
//
// Medido ao vivo na sessão logada do TutorBird: o app deles roda "Inter
// Variable" com fallback `system-ui, -apple-system, "Segoe UI", Roboto, Arial`.
// Aqui é o mesmo: `next/font/google` baixa e SELF-HOSTA a Inter no build (zero
// request ao Google em produção, zero FOUT de terceiro) e a variável
// `--font-inter` é consumida pelo `globals.css`, que monta a pilha com esse
// mesmo fallback.
//
// `Inter` do Google é FONTE VARIÁVEL: não se declara `weight` — o eixo inteiro
// (100–900) vem num arquivo só, e os pesos que a UI usa (400 corpo, 500 rótulo,
// 600 dado, 700/800 número e título) saem dele sem download extra. Fixar a lista
// de pesos aqui forçaria instâncias estáticas e MAIS bytes, não menos.
//
// O par anterior (Bricolage Grotesque display + Hanken Grotesk corpo) saiu do
// site: nas telas novas o número-destaque passa a ser Inter bold + `tabular-nums`.
// As telas velhas herdam a troca pela raiz — é o único efeito desta rodada sobre
// elas, e é deliberado (a marca tipográfica do produto é uma só).
// ⚠️ A Bricolage CONTINUA viva onde nunca foi web font: os decks .pptx da
// Fábrica de Slides (`src/lib/slides/`) pedem a família pelo NOME ao desenhar o
// arquivo — nada ali passa por este layout.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// SEGUNDA FAMÍLIA — **Roboto**, e SÓ para a voz da NAVEGAÇÃO (lote 10, 26/07).
//
// Medição ao vivo na sessão logada do TutorBird (computed styles reais): o app
// deles é um MIX. Os componentes Material — sidebar, nav, menus — rodam
// `Roboto` 16px/400 com `letter-spacing: 0.496px` (= 0.031em) e `line-height:
// 24px`; o CONTEÚDO (títulos, botões, abas, corpo) roda Inter. Vestir tudo de
// Inter, como estava, deixava a navegação com desenho e ritmo diferentes do
// original — foi exatamente a queixa do dono ("a fonte ainda não me parece a
// mesma").
//
// Aqui a Roboto entra pelo MESMO caminho da Inter: `next/font/google`
// self-hosta no build (zero request ao Google em produção) e publica
// `--font-roboto`, que o `globals.css` monta na pilha `--font-pt-nav`.
//
// Por que `weight` explícito e não a variável: a Roboto do Google é variável,
// mas a voz da navegação usa TRÊS pesos fixos e conhecidos — 400 (item do
// trilho e item de menu), 500 (reserva de rótulo) e 700 (reserva de ênfase).
// Baixar as três instâncias estáticas é menos byte do que o eixo inteiro para
// um uso tão estreito. Corpo, título e número seguem sendo Inter — a Roboto
// NÃO é a fonte do site.
const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

// Mono permanece JetBrains: nenhuma tela nova a usa (número virou Inter
// tabular), mas as telas velhas ainda vestem `font-mono` em hora e código, e
// trocá-la por mono de sistema seria diff visual sem pedido.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Personal Teacher Academy",
  description: "Portal da Personal Teacher Academy",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${inter.variable} ${roboto.variable} ${jetbrainsMono.variable} h-full`}
    >
      {/* Papel por padrão (áreas internas dominam o uso); as públicas cobrem
          a viewport com a própria capa noturna (fog fixo). */}
      <body className="min-h-full flex flex-col bg-paper-50">
        {/* QA 14/07/2026: feedback global de clique/envio (useSearchParams exige
            Suspense no root; fallback null não pisca nada). */}
        <Suspense fallback={null}>
          <ClickFeedback />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
