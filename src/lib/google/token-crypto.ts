import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// Cifra do refresh token do Google (ADR-017). AES-256-GCM com chave única em
// env (GOOGLE_TOKEN_KEY, 32 bytes em base64) — o banco/backup/audit_log só
// veem o blob. Formato do blob: v1.<iv>.<tag>.<ct> (tudo base64), para uma
// futura troca de algoritmo não exigir adivinhar o formato antigo.
// GCM autentica além de cifrar: blob adulterado ou chave errada = exceção,
// nunca um token corrompido usado em silêncio.

const VERSION = 'v1'

export function tokenKeyFromEnv(): Buffer | null {
  const raw = process.env.GOOGLE_TOKEN_KEY
  if (!raw) return null
  const key = Buffer.from(raw, 'base64')
  return key.length === 32 ? key : null
}

export function encryptToken(plain: string, key: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join('.')
}

export function decryptToken(blob: string, key: Buffer): string {
  const [version, ivB64, tagB64, ctB64] = blob.split('.')
  if (version !== VERSION || !ivB64 || !tagB64 || !ctB64) {
    throw new Error('blob de token em formato desconhecido')
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8')
}
