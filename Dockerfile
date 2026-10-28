# App Next.js (Fase 2) — build determinístico para o Coolify (runbook §K).
# As NEXT_PUBLIC_* são INLINADAS no build: o Coolify precisa passá-las como build args.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
# Heap do Node no build: a base cresceu com as integrações da construção total
# (14/07) e o type-check do `next build` estourava ~1,9 GB no container do VPS
# (CX33, 8 GB). 19/07: deploy caiu com exit 255 (conexão do Coolify) durante o
# type-check — teto de 4 GB deixava o Node adiar GC e o VPS (com o stack todo
# rodando) entrava em swap. tsc medido: pico 1,8 GB → 3 GB bastam e limitam a
# pressão. Vale SÓ para o build (não afeta o runner nem o local).
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--max-old-space-size=3072
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# yt-dlp: transcript dos vídeos do listening (Fábrica de Slides FS-M3, ADR-022).
RUN apk add --no-cache yt-dlp
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
