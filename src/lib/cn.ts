// Junta classes condicionais (clsx) e resolve conflitos de utilities do
// Tailwind (tailwind-merge) — a última classe vence de verdade.
// Usado pelos primitivos de `src/components/kit/` (ADR-025). Server-safe:
// nenhuma dependência de runtime de cliente.
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
