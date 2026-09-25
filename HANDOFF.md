# Handoff — Gestão Comercial

Documento para **outras IAs** (e humanos) que forem continuar este repositório.
Leia isto **antes** de alterar código. UI em português do Brasil. Código e
identificadores em inglês.

Produto: ERP/PDV desktop-first para loja (vestuário e mix). Multi-tenant
(`company_id` em toda linha de negócio). Primeira conta cria empresa + loja e
semeia o demo.

Repo: [github.com/victorhenriquers90/gestao-comercial](https://github.com/victorhenriquers90/gestao-comercial)
(privado). Fluxo de PR entre IAs conforme COLLAB.md.

## Stack

| Camada | Tecnologia |
|---|---|
| App | TanStack Start + Router + React 19 |
| Estilo | Tailwind v4 (`src/styles.css` `@theme`) + Radix |
| Dados | Postgres (Neon se `DATABASE_URL`; senão PGLite WASM) |
| Auth | Better Auth, e-mail/senha. **Sem** Google/X na UI |
| Server | `createServerFn` + `authMiddleware` em `src/lib/server/*` |
| Estado UI | TanStack Query + Zustand (`useSelection`) |

Rodar:

```bash
npm install
npm run dev          # Vite 0.0.0.0:8080
npm run typecheck
npm run test
npm run db:migrate   # SQL em /migrations (não editar aplicadas; criar a próxima)
```

Sem `DATABASE_URL` o schema sobe no PGLite na primeira query. Com URL, é
Postgres de verdade. Auth: `VITE_AUTH_ENABLED` (ver `.grok/app-env.json` e
`scripts/with-app-env.mjs`). E-mail/senha ligado em
`src/lib/auth/email-password.ts`.

## Mapa

```
src/routes/app/          telas (pdv, produtos, clientes, …)
src/routes/login.tsx     capa / login
src/lib/server/          mutations e queries (tenant scoped)
src/lib/document.ts      CPF/CNPJ (módulo 11)
src/lib/check-digit.ts   módulo 11 + GTIN/EAN
src/lib/tax.ts           INSS/IRRF/ISS/MEI 2026
src/lib/commission.ts    regras de comissão
src/lib/sanitize.ts      XSS / linhas
src/lib/auth/csrf.ts     CSRF double-submit
src/lib/permissions.ts   papéis e perms
src/lib/nfce.ts          payload e regras da NFC-e (Focus NFe)
migrations/              0001…0022
```

Toda mutation de negócio: `requireTenant` → `assertCan` → SQL com
`company_id = tenant.companyId`. Não invente query sem esse filtro.

## Invariantes (não quebrar)

1. **Desktop-first.** Layout de caixa, não app de celular. PDV em duas colunas
   (itens da venda | cupom): busca + tabela de itens na coluna larga, total +
   pagamento + ações no cupom. Resultado da busca é painel suspenso — não
   volte a dar a coluna larga para os resultados (a venda ficava com um item
   visível em 1366×768). Componentes em `src/components/pdv/`, contas em
   `src/lib/pdv-sale.ts` (testadas). O Finalizar nunca sai da vista: ações
   presas no pé do cupom e modo compacto em telas baixas (~650px de viewport
   num monitor 1366×768 com navegador).
2. **Caixa aberto** para finalizar venda (`checkoutFn`).
3. **Um caixa aberto por loja** (índice parcial `cash_registers_one_open_idx`).
4. **CPF/CNPJ:** vazio ok; preenchido = módulo 11; único por empresa
   (`0020_document_unique.sql`). PDV F4 = documento na nota (`cpfNaNota` aceita
   CPF ou CNPJ). Seed já tem DVs válidos.
5. **EAN 8/12/13/14:** GTIN módulo 10. SKU alfanumérico não passa por GTIN.
6. **Sem OAuth social na tela.** Login e-mail/senha. CSRF + sanitização nas
   mutações. Não religar Google/X sem pedido explícito.
7. **Comissão** calcula no checkout; líquido (INSS/IRRF/ISS) em
   `src/lib/tax.ts`. MEI não retém ISS da mesma forma que PJ.
8. **Idioma da UI:** pt-BR. Toasts e erros para o operador, não para o
   desenvolvedor.
9. **Tipografia editorial:** Outfit (corpo), Syne (títulos), IBM Plex Mono
   (cupom). Kicker = classe `ed-label` (11px, uppercase, tracking 0.14em).
   Não voltar para Inter / Plus Jakarta / Fraunces. Não meter terceira família
   de texto.
10. **Foto de login:** `/public/login-store.jpg`, `object-fit: cover`, full-bleed
    atrás do cartão. Não recortar rostos; `object-position: 58% 32%`.
11. **Design é sistêmico.** Mudança visual que vale pra "todas as telas" entra
    em `src/components/ui/*`, `src/components/shared.tsx`, `app-shell.tsx` ou
    nos tokens do `styles.css` — não tela por tela. Os KPIs seguem chapados de
    propósito (`.kpi-card` zera `box-shadow`/borda pro filete editorial), mesmo
    com `Card` tendo `shadow-soft` por padrão.
12. **`prefers-reduced-motion` é tratado globalmente** por um reset em
    `styles.css` (`*`, `::before`, `::after` com duração mínima). Vale pros
    keyframes daqui **e** pro `tw-animate-css` (diálogos, abas, card do
    login), que não trata isso sozinho. Não precisa guardar animação nova
    caso a caso — e não remova o reset achando que é redundante.

## Domínio rápido

- **PDV** (`/app/pdv`): F2 busca, F4 documento, F6 desconto, F8 pagamento,
  F9 guardar, F10 finaliza (sem pagamento informado = dinheiro, valor exato;
  com pagamento informado, usa o informado mesmo com o F8 fechado). Com a
  busca vazia: ↑/↓ escolhe item, +/− quantidade, Delete remove. O pedido de
  CPF é um lembrete no cupom, não um diálogo automático (o diálogo roubava o
  foco e a próxima bipagem caía no campo de CPF). Crediário exige cliente
  (CPF na nota cria Consumidor).
- **Vendedores:** regime `none|clt|autonomo|mei|pj` define CPF vs CNPJ.
- **Promoções** entram no preço da linha via `bestPromo`.
- **Estoque** por variante × loja; `allow_negative_stock` nas settings.
- **Papéis:** admin, gerente, vendedor, caixa, pdv (só PDV — sem dashboard,
  vendas, produtos etc., nem no menu nem no servidor), estoque, financeiro.
  Toda leitura sensível (`listSellersFn`, `listProductsFn`, `dashboardFn`
  etc.) passa por `assertCan` — não é só o menu que esconde, o servidor barra
  de verdade. Páginas cuja query principal é protegida mostram
  `QueryError` (`src/components/shared.tsx`) em vez de renderizar vazio
  quando o papel não tem a permissão.

## O que já está feito (não refazer)

Faturamento líquido de devolução: `sales.total`/`cost_total` nunca são
reduzidos numa devolução parcial (o valor fiscal original tem que ficar
intacto), então toda soma que filtrava só `status = 'finalizada'` fazia a
venda inteira SUMIR da conta por causa de uma peça devolvida, em vez de só
o valor devolvido sair. Corrigido em `commission.ts` (faixa de comissão,
progresso de meta), `insight.ts` (dashboard inteiro), `reports.ts`
(resumo, vendedor, produto/ABC/categoria/cliente, lucro/margem, DRE, giro),
`party.ts` (LTV do cliente, faturamento do vendedor), `purchase-suggestion.ts`
(consumo diário) e `finance.ts` (fluxo de caixa, progresso de meta na tela
Metas — mais uma cópia do mesmo cálculo de "realizado" de commission.ts/
insight.ts). Padrão: `status in ('finalizada','devolvida_parcial')` +
`left join lateral` somando `return_items` — por venda (`si.sale_id =
s.id`) na maioria, por linha (`ri.sale_item_id = si.id`) onde o relatório
já agrega por produto, mais preciso. Em tagged template (`` sql`...` ``) o
join vai escrito por extenso — `${...}` ali vira parâmetro, não texto SQL
cru, então não dá pra reusar a constante que os sites em `.query()`
compartilham. Exceção deliberada: fluxo de caixa e o relatório de
"Pagamentos" somam `payments.amount` (o que entrou de verdade em cada
forma no checkout), não `sales.total` — devolução
não desfaz o pagamento original, só alargou o filtro de status, sem
descontar nada.

Fluxo de caixa também atribuía recebimento/pagamento de título ao dia
errado quando o título era pago em mais de uma parcela em dias diferentes
(crediário, carnê): `received_amount`/`paid_amount` são cumulativos na
linha do título e `received_at`/`paid_at` só gravam data quando o título
fecha 100%, então uma parcela intermediária ficava com data `null` (sumia
do relatório naquele dia) e a parcela final "herdava" a soma de todas as
parcelas anteriores no dia dela. Corrigido em `cashflowFn` (`finance.ts`):
soma agora vem de `audit_logs.after_data.amount` (gravado por evento, não
cumulativo) em vez da linha resumo do título — sem migração, a tabela já
existia. Não afeta o fechamento de caixa (esse usa `cash_movements`, que
já ganha uma linha nova por baixa em dinheiro).

Trava de duplo-clique em Pagar/Confirmar/Salvar do Financeiro
(`financeiro.tsx`): os quatro botões (baixa de conta a pagar, confirmação
de recebimento, criação de conta a pagar e de título a receber) só tinham
`disabled={!condição}`, que não cobre o pedido já em voo. Mesma trava
síncrona (`useState` checado antes do disparo) que já existia no
formulário de Despesa, agora nos quatro pontos.

Auditoria de duplo-clique estendida a rotas e componentes que ainda não
tinham passado por isso: mesma trava aplicada em `produtos.tsx` (Salvar
produto — único cadastro do sistema sem nenhuma trava), `crediario-panel.tsx`
(Confirmar recebimento — segunda porta de entrada pro mesmo
`settleReceivableFn` do Financeiro, em `src/components/`, fora do alcance
do sweep de rotas), `commission-panel.tsx` (Salvar regra e as duas entradas
de "Pacote sugerido" — regra de comissão duplicada empata de forma
imprevisível na hora de calcular comissão) e `stock-count-panel.tsx`
(Remover item — único botão do arquivo sem a trava `ocupado` que todo o
resto já usa). Lição: a auditoria de rota (`src/routes/app/*.tsx`) não
enxerga componentes compartilhados em `src/components/`, que precisam de
uma varredura própria.

Também no mesmo sweep de componentes: `commission-net.tsx` simulava
regime tributário diferente pro MESMO vendedor sem regime configurado,
dependendo de como a tela chegou lá (seleção inicial caía em "autonomo",
trocar de vendedor e voltar caía em "none" via `pickSeller`) — o padrão do
resto do sistema (`party.ts`) é "none". Corrigido para os dois caminhos
usarem o mesmo fallback. Auditoria completa do PDV
(`payment-dialog.tsx`, `cart-table.tsx`, `discount-dialog.tsx`,
`sale-bar.tsx`, `held-sales-dialog.tsx`, `nfce-status.tsx` e o corpo de
`finish()`/`holdCart()`/`resumeHeld()` em `pdv.tsx`) não achou mais nada:
todas as travas contra duplo-clique já usam a `ref` síncrona correta, e
`resumeHeldFn` já é atômico no servidor (`delete ... returning`).

**Segurança**: auditoria dedicada não achou SQL injection em nenhum
`.query()` do backend (todo valor externo vai por parâmetro, nunca colado
no texto). Achou e corrigiu uma vulnerabilidade real de isolamento entre
empresas: `saveProductFn` conferia dono de marca/categoria/fornecedor mas
não do PRÓPRIO produto sendo editado — enviar o id de um produto de outra
empresa, sem variantes no payload, criava uma variante com `company_id`
certo mas `product_id` apontando pro produto alheio, e um join
variante→produto (o mesmo que checkout/busca fazem) passava a mostrar
nome/preço/custo de outra empresa. Corrigido com `assertOwned(sql,
companyId, "products", data.id)`. Varredura nos outros pontos de
`assertOwned` (comissão, cliente, vendedor, compra) não achou mais nenhuma
instância do mesmo padrão — `savePurchaseFn` já tinha a proteção certa
(select + checagem de "não encontrado" antes de reescrever itens), e os
demais não fazem cascata em tabela filha.

**Foto de produto e logo da loja nunca eram salvas** (bug funcional, não
de segurança): `sanitizeHttpUrl` rejeita `data:` de proposito, mas o único
jeito de definir essas duas fotos (upload ou geração por IA) sempre passa
pelo editor de recorte, que só devolve `canvas.toDataURL()` — uma data
URL. O campo salvava como NULL, em silêncio, sem erro nenhum. Confirmado
no banco do piloto antes da correção: 0 de 48 produtos e nenhuma das 4
empresas tinham foto gravada. Corrigido com uma sanitização própria
(`sanitizeImageUrl`, em `sanitize.ts`) que aceita `data:image/...` válido
OU delega pra `sanitizeHttpUrl` pra um link http(s) de verdade.

**Checagem de papel ausente em `refreshNfceStatusFn`** (nfce.ts): das
quatro funções de NFC-e, era a única sem `assertCan`/`can` nenhum —
qualquer papel autenticado da empresa podia consultar/regravar o status
fiscal de qualquer venda com um `saleId` arbitrário. Corrigido com o mesmo
par de permissões das duas telas que chamam de verdade (`sales.read` +
`pdv.sell`, padrão OR já usado em `simulateCommissionFn`). Uma varredura
das ~150 server functions do backend não achou mais nenhuma instância —
confirmou que as três correções anteriores desta sessão e de sessões
passadas (`saveProductFn`, `toggleCrmTaskFn`, `simulateCommissionFn`,
`globalSearchFn`) seguem corretas.

Liquidação em lote de cartão (`card-settlement.ts`, `settleCardBatchFn`):
gravava auditoria só a nível de LOTE (`entity='card_settlement'`), sem
uma entrada por título (`entity='accounts_receivable'`) como
`settleReceivableFn` grava. Ficou invisível para o fluxo de caixa depois
que ele passou a somar por `audit_logs` (ver abaixo) — regressão
corrigida no mesmo dia em que foi introduzida.

Backup do banco (`installer\lib\Backup.ps1`, `Backup-GestaoComercial.ps1`,
`Restore-GestaoComercial.ps1`): tarefa diária do Windows às 22:30 por SYSTEM,
dump `-Fc` verificado com `pg_restore --list` **antes** de receber o nome
definitivo (escrito como `.partial` até passar), retenção 30 dias com piso de
7 cópias, backup obrigatório antes de migration numa atualização (falhou →
atualização abortada), e `-BackupSecondaryDir` para cópia fora da máquina.
Testado na loja piloto: 44 tabelas, contagem de linhas do dump conferida
contra o banco vivo tabela a tabela, e a verificação rejeitando dump
truncado e vazio. A tela de Configurações lê `last-backup.json`
(`src/lib/server/backup.ts`, `src/lib/backup-status.ts`,
`BackupStatusCard`) e avisa quando o último backup passa de 48h (crítico
com 7 dias), com severidade separada para a cópia externa — o backup local
pode estar em dia enquanto o pendrive está fora da tomada há semanas, e as
duas coisas não podem virar um "OK" só.

Cadastro completo (produto/grade, cliente, fornecedor, compra, estoque,
financeiro, caixa, CRM, metas, promoções, devoluções, relatórios). Folha de
comissão com faixas, bônus de meta, retenções. CSRF, sanitização, CPF/CNPJ,
unicidade de documento/EAN, índices (trgm/GIN). Login com foto da loja.
Visual editorial (kicker / Syne / filete nos KPIs). Chips PF/PJ/com débito no
F4 (`listCustomersFn`). Documento (CPF/CNPJ) persistido na própria venda
(`sales.document`, migration 0021) — a listagem de vendas e o comprovante
reimpresso mostram o documento usado na hora da venda, não o documento
*atual* do cliente. Etiqueta/código de barras por peça
(`src/components/price-tag.tsx`, Code128 via `jsbarcode`) — uma etiqueta por
produto sem variantes, uma por variante quando há grade de cor/tamanho.
Token `--space-beat` aplicado no `.kpi-card` (escopo reduzido de propósito).
NFC-e via Focus NFe (`src/lib/nfce.ts`, `src/lib/server/nfce.ts`), homologação
por padrão — configura em Configurações → Impostos (IE, regime tributário,
`nfce_enabled`). Com a NFC-e ligada (e `FOCUS_NFE_TOKEN` no servidor), o PDV
emite sozinho logo depois de finalizar (`emitNfceAfterCheckoutFn`: só
`pdv.sell`, só a venda do próprio operador nos últimos 30 min) e mostra o
status no comprovante; falha não desfaz a venda e a nota sai de novo por
`vendas.tsx` (gerente/admin, `sales.write`). Papel
"Operador de PDV" com permissão real no servidor (ver "Papéis" acima).
Mensagens de erro do login em pt-BR (mapeadas pelo `code` do Better Auth, não
pela `message` em inglês — ver `src/routes/login.tsx`). Token
`--spacing-block: 0.75rem` (mesmo valor de `gap-3`/`mt-3`/`space-y-3`)
adotado (`gap-block`/`mt-block`/`mb-block`/`space-y-block`) em quase toda
tela: `fornecedores.tsx`, `clientes.tsx`, `compras.tsx`, `caixa.tsx`,
`configuracoes.tsx`, `devolucoes.tsx`, `estoque.tsx`, `financeiro.tsx`,
`index.tsx`, `metas.tsx`, `produtos.tsx`, `promocoes.tsx`, `vendas.tsx`,
`vendedores.tsx` e `pdv.tsx`. Falta só `relatorios.tsx`, e de propósito: a
única ocorrência lá é a barra de filtro, espaçamento local, não "entre
blocos". Cada `gap-3`/`mt-3`/`space-y-3` que sobrou nessas telas foi deixado
de propósito — é espaçamento local (dentro de uma linha, grid de KPI, barra
de progresso, padding interno), não ritmo "entre blocos".

Modernização da tela de login (sombra do card, largura maior a partir de
1024px, gradiente radial na foto, zoom lento, ícones nos campos, tela de
carregamento com a mesma foto) e a rodada sistêmica que vale pra todas as
telas: transição de entrada de página (`.page-enter`, re-keyed pelo pathname
no `AppShell`), filete do item ativo na sidebar, `Skeleton` com brilho
varrendo em vez de pulse, `EmptyState` com ícone em círculo, `Tabs` com
hover/foco/fade, `Card` com `shadow-soft`, e barra de rolagem + seleção de
texto no tema do app.

## Próximos (se o usuário disser “continuar”)

1. ~~Hospedagem de produção (Vercel + Neon)~~ — **decidido e feito de outro
   jeito**: o sistema roda **on-premise**, instalado na máquina da loja
   (Postgres local + serviço do Windows via NSSM + acesso remoto por
   Tailscale). Ver `installer\README.md`. O caminho Vercel + Neon continua
   existindo no código (migrations no `npm run build`), mas não é o que está
   em produção — não mexa nele achando que é o alvo.

2. ~~Devolução parcial some da venda inteira em faturamento/relatório/LTV~~
   — **corrigido por completo** em `commission.ts`, `insight.ts`,
   `reports.ts`, `party.ts` e `purchase-suggestion.ts`. Ver "O que já está
   feito" para o padrão usado.

3. **Pendente, precisa do usuário**: criar `migrations/0029_drop_nfce_foundation.sql`
   (conteúdo já combinado numa sessão anterior — remove a migration
   0022_nfce_foundation registrada sem arquivo) e rodar `npm run db:migrate`.
   A IA não conseguiu criar esse arquivo diretamente (bloqueado por
   classificador de segurança nas duas tentativas). Até lá, `npm run build`
   imprime o aviso inofensivo "migration(s) registrada(s) sem arquivo".

4. **Pendente, decisão do usuário**: apagar ou não os dados de demonstração
   do piloto antes de ir para produção de verdade.

O `--spacing-block` já rodou em todas as telas que qualificam, o `pdv.tsx`
inclusive — a conversão lá foi verificada instância por instância (12/12 em
12px, incluindo os diálogos de F4/F6/F8) e com uma venda de ponta a ponta.

## Como a próxima IA deve trabalhar

- Mudança pequena e verificável; `npm run typecheck` depois de TS.
- Testes em `src/lib/*.test.ts` para regra de domínio (CPF, comissão, tax).
  `npm test` pega `src/**/*.test.ts` por glob — arquivo novo entra sozinho,
  não precisa listar. **Use aspas duplas no glob**: com aspas simples o
  cmd.exe não desmonta a string, o node recebe as aspas literais, casa zero
  arquivo e o script **sai 0** — foi assim que `tax.test.ts` e
  `commission.test.ts` (41 testes de retenção e comissão) ficaram fora da
  suíte sem ninguém notar.
- `npm run test:scripts` roda os testes do andaime (`scripts/**`), fora do
  `npm test` de propósito. **Hoje passa 193/193.** Chegou a ter 13 falhas, e
  nenhuma era bug do produto:
  - 8 eram testes não-herméticos — `normalizeHeadContext` cai no workspace
    real quando `ctx.site` é omitido, e `applyCustomCardFromFs` procura
    `public/og.*`. Enquanto isto era o template os dois davam vazio; virou app
    de verdade (nome próprio, `public/og.jpg`) e vazaram pras asserções.
    Resolvido fixando `cwd`/`site` nesses testes, sem afrouxar asserção.
  - 5 afirmavam o que o template vazio embarcava (auth off no
    `.grok/app-env.json`, `migrations/` sem nada na raiz). 2 foram aposentadas
    e 3 reescritas pro invariante real do app.

  Se voltar a ficar vermelho, **desconfie primeiro do teste ler o workspace**
  antes de mudar o produto pra caber na asserção.
- Migration nova se mudar schema; nunca reescrever `0001`–`0020`.
- Não “explorar” 800 palavras se o usuário pediu para implementar.
- Não adicionar Google/X, mobile-first, ou tema roxo.

Prompt inicial sugerido para a outra IA:

> Continue o ERP Gestão Comercial (TanStack Start, pt-BR, desktop).
> Leia HANDOFF.md e AGENTS.project.md. Não quebre tenant isolation,
> checkout com caixa aberto, nem validação CPF/CNPJ/EAN.
