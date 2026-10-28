# Evolution API 2.3.7 (a imagem que roda em produção, fixada pelo digest) com o
# Baileys trocado pela correção da PR WhiskeySockets/Baileys#2765
# (companion_reg_refresh: o WhatsApp mudou o pareamento em 28/07/2026 e nenhuma
# versão publicada do Baileys acompanhou). Commit do fork fixado; diff lido em
# 26/10/2026 (só src/Socket/socket.ts e src/Utils/companion-reg-client-utils.ts
# mudam, fora os testes). Receita confirmada por terceiros na mesma versão
# (comentário de 10/09/2026 na issue #2737). Volta = tag `latest` no Coolify.
FROM evoapicloud/evolution-api@sha256:966625532d9076a2381e973a271307d107e6f070450de3abeeea8bd18be07252
WORKDIR /evolution
# Alpine mínimo: o npm precisa do git para clonar o fork, e o `prepare` do
# pacote compila o TypeScript. Tudo em um RUN para o git sair da imagem final.
RUN apk add --no-cache git \
 && npm install --no-audit --no-fund \
      baileys@github:doryani-ai/Baileys#4f263f0e365c2e74dd1b824031d1c5910f518c26 \
 && apk del git \
 && npm cache clean --force \
 && grep -m1 '"version"' node_modules/baileys/package.json \
 && grep -c companion_reg_refresh node_modules/baileys/lib/Socket/socket.js
