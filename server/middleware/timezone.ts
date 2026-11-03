/**
 * Fixa o fuso do processo Node em America/Sao_Paulo assim que o Nitro sobe
 * -- antes de qualquer requisicao.
 *
 * `ymdLocal` (src/lib/local-date.ts) e tudo que depende dela (vencimento de
 * cartao/crediario, "hoje" dos relatorios, janela de promocao, etc.) usa os
 * getters LOCAIS do Date (getFullYear/getMonth/getDate) de proposito, pra
 * nao sofrer o desvio de `toISOString()` -- mas esses getters so dao o dia
 * certo se o PROCESSO achar que esta no fuso da loja. Vercel Functions
 * rodam em UTC por padrao, e nada neste repo setava TZ antes deste arquivo:
 * uma venda feita entre 21h e meia-noite (Brasilia, UTC-3) virava "amanha"
 * pro servidor, e todo vencimento calculado a partir dela saia um dia
 * depois do que o PDV mostrava na tela.
 *
 * Confirmado ao vivo em producao (sessao de teste de 02/11/2026, item 150
 * do HANDOFF): venda de cartao as 23h38 previu 02/12 no PDV (calculo no
 * navegador, sempre correto), gravou 03/12 no banco; venda de crediario as
 * 23h41 previu 02/12, gravou 03/12. Mesmo mecanismo que local-date.test.ts
 * ja usa pra forcar o fuso certo nos testes (`process.env.TZ =
 * "America/Sao_Paulo"` em before()) -- so que ali so vale dentro do test
 * runner. Aqui fixa pro processo de verdade, antes da primeira requisicao.
 *
 * Nao e instalado em `src/lib/server/*.ts`: esses arquivos alimentam
 * `createServerFn` e podem acabar puxados pro bundle do navegador por uma
 * cadeia de import (ver o comentario de `readInviteCookie` em
 * `src/lib/server/context.ts`) -- `process` pode nem existir la. Este
 * diretorio (`server/middleware/`) e Nitro puro, nunca bundlado pro
 * cliente; `vite.config.ts` ja registra `serverDir: "./server"` e o Nitro
 * descobre este arquivo sozinho, igual a `grok-pwa.ts` ao lado.
 */
process.env.TZ = "America/Sao_Paulo";

export default function timezoneMiddleware(
  _event: unknown,
  next: () => unknown | Promise<unknown>,
): unknown | Promise<unknown> {
  return next();
}
