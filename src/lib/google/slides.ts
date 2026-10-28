import { google, type drive_v3, type slides_v1 } from 'googleapis'

// Geração de Slides (Fase 4, handoff §3 + CLAUDE.md §Stack). Fatos conferidos
// na doc oficial do Google em 14/07/2026 (agente de verificação):
//  - Service account: JWT com escopo ÚNICO https://www.googleapis.com/auth/drive
//    (cobre copy/get/export E batchUpdate de Slides); o template é COMPARTILHADO
//    com o client_email da SA.
//  - SA NÃO TEM STORAGE próprio: a cópia nasce em pasta/Drive compartilhado
//    (parents + supportsAllDrives: true) — decisão operacional no runbook §N.
//  - files.copy {name, parents} → batchUpdate replaceAllText (containsText
//    {text, matchCase: true}) — o batch é ATÔMICO ("if any request is not
//    valid... nothing will be applied").
//  - Export PDF: files.export mimeType application/pdf (limite 10MB).
//  - 429/403 de quota → backoff exponencial truncado (recomendação oficial).
// ⚠️ REGRA DE OURO (Lei do template): NUNCA manipular o template primário —
// toda escrita acontece na CÓPIA (caso de teste 4 do handoff).

export interface GoogleClients {
  drive: drive_v3.Drive
  slides: slides_v1.Slides
}

/**
 * ⚠️ DUAS service accounts coabitam em produção (21/07): a Fábrica de
 * Conteúdo usa `GOOGLE_SERVICE_ACCOUNT_JSON` (fabrica-conteudo@…) e a Fábrica
 * de Slides usa `GOOGLE_SERVICE_ACCOUNT_B64` (ptos-slides@…, a única com
 * acesso ao Drive compartilhado dos decks). Quem precisa da conta dos slides
 * chama com { preferB64: true } — sem isso o app autentica com a conta errada
 * e o destino "não é encontrado" (achado do 1º deck real).
 * O base64 é o formato seguro no Coolify: JSON cru com aspas/quebras já
 * derrubou o .env do serviço (lição 19/07).
 */
export function googleClientsFromEnv(opts: { preferB64?: boolean } = {}): GoogleClients | null {
  const fromB64 = process.env.GOOGLE_SERVICE_ACCOUNT_B64
    ? Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_B64, 'base64').toString()
    : undefined
  const fromJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  const raw = opts.preferB64 ? (fromB64 ?? fromJson) : (fromJson ?? fromB64)
  if (!raw) return null
  const key = JSON.parse(raw) as { client_email: string; private_key: string }
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/drive'],
  })
  return {
    drive: google.drive({ version: 'v3', auth }),
    slides: google.slides({ version: 'v1', auth }),
  }
}

/** Backoff exponencial truncado (recomendação oficial p/ 429/403 de quota). */
async function withBackoff<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let lastErr: unknown
  for (let n = 0; n < tries; n++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const status = (err as { code?: number; response?: { status?: number } })
      const code = status.code ?? status.response?.status
      if (code !== 429 && code !== 403) throw err
      await new Promise((r) => setTimeout(r, Math.min(2 ** n * 1000 + Math.random() * 250, 8000)))
    }
  }
  throw lastErr
}

export interface DeckFromTemplateOpts {
  clients: GoogleClients
  templateId: string
  /** pasta destino (Shared Drive ou pasta compartilhada — runbook §N) */
  parentFolderId: string
  name: string
  /** {'aluno': 'Sabrina', ...} → substitui {{aluno}} na CÓPIA (matchCase). */
  replacements: Record<string, string>
}

export async function generateDeckFromTemplate(
  opts: DeckFromTemplateOpts,
): Promise<{ fileId: string; url: string }> {
  // 1) Copia SEMPRE — o template primário nunca recebe batchUpdate.
  const copy = await withBackoff(() =>
    opts.clients.drive.files.copy({
      fileId: opts.templateId,
      supportsAllDrives: true,
      requestBody: { name: opts.name, parents: [opts.parentFolderId] },
    }),
  )
  const fileId = copy.data.id
  if (!fileId) throw new Error('files.copy não devolveu id da cópia')
  if (fileId === opts.templateId) {
    throw new Error('invariante violada: cópia com o MESMO id do template')
  }

  // 2) Merge atômico dos placeholders NA CÓPIA (tudo-ou-nada).
  const requests: slides_v1.Schema$Request[] = Object.entries(opts.replacements).map(
    ([key, value]) => ({
      replaceAllText: {
        containsText: { text: `{{${key}}}`, matchCase: true },
        replaceText: value,
      },
    }),
  )
  if (requests.length > 0) {
    await withBackoff(() =>
      opts.clients.slides.presentations.batchUpdate({
        presentationId: fileId,
        requestBody: { requests },
      }),
    )
  }
  return { fileId, url: `https://docs.google.com/presentation/d/${fileId}/edit` }
}

/** Exporta a apresentação em PDF (limite oficial de 10MB no export). */
export async function exportDeckPdf(clients: GoogleClients, fileId: string): Promise<Buffer> {
  const res = await withBackoff(() =>
    clients.drive.files.export(
      { fileId, mimeType: 'application/pdf' },
      { responseType: 'arraybuffer' },
    ),
  )
  return Buffer.from(res.data as ArrayBuffer)
}

/** Baixa um arquivo do Drive (gravação de aula p/ o worker de auditoria). */
export async function downloadDriveFile(clients: GoogleClients, fileId: string): Promise<Buffer> {
  const res = await withBackoff(() =>
    clients.drive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' },
    ),
  )
  return Buffer.from(res.data as ArrayBuffer)
}
