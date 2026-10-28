// O INTERRUPTOR DA SUPERFÍCIE DE ASSINATURA (ADR-029 §1).
//
// POR QUE ELE EXISTE. O motor de assinatura (reserva atômica antes da chamada
// externa, webhook idempotente, atos humanos auditados) está no banco e é
// testado no nível de dados. O que NÃO existe é o `AUTENTIQUE_TOKEN`: ele é
// gate externo pendente (🔑), e sem ele nenhum botão desta parte do app pode
// fazer o que promete — "Enviar para assinatura" recusa na hora, "Anexar id do
// documento" pede um id que ninguém tem, e a consulta de status não tem a quem
// perguntar. Tela que oferece o que não pode cumprir é pior do que tela que
// falta: ela gasta o tempo da pessoa e ainda a faz duvidar do resto.
//
// A REGRA, então: sem a env, a seção Assinatura do detalhe do contrato mostra
// SÓ o aviso honesto, e nenhum dos três painéis (`assinatura`,
// `reserva-anexar`, `reserva-cancelar`) é alcançável — nem pelo botão, nem pelo
// endereço colado (mesma rede de baixo do contrato encerrado). Com a env, tudo
// volta, sem mais nada a religar.
//
// A LEITURA É POR CHAMADA, e de propósito: uma constante de módulo congelaria o
// valor no primeiro import do processo, o que é ruim em produção (a env entra
// no deploy) e impossível de exercitar em teste. Assim `vi.stubEnv` — ou o
// próprio Coolify — muda a resposta sem truque nenhum. É o mesmo formato de
// `autentiqueConfigFromEnv()`, que lê a mesma variável para MONTAR o cliente;
// aqui só se pergunta se ela existe, e o valor nunca sai do servidor.

export function assinaturaLigada(): boolean {
  return Boolean(process.env.AUTENTIQUE_TOKEN)
}
