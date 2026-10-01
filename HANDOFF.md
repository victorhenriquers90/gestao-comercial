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

**Editar qualquer produto apagava categoria, descrição, marca, fornecedor
e corrompia a grade de variantes** (`produtos.tsx` + `catalog.ts`,
`saveProductFn`) — o bug mais sério achado nesta sessão em termos de dado
real destruído. O dialogo de editar abria com dados incompletos (o clique
na linha usava o RESUMO da listagem, que nem tem `category_id`/
`description`; a busca global esquecia `description`), e o servidor
sobrescrevia com NULL tudo que não veio no payload — inclusive marca e
fornecedor, que **nunca** têm campo neste formulário, logo sempre viravam
null em qualquer edição. Como a grade de variantes também nunca vem
preenchida ao editar, `has_variants` virava `false` a cada save, disparando
um bloco que sobrescrevia UMA variante arbitrária com os dados do produto.
Um "Salvar" sem mudar nada apagava tudo isso, silenciosamente, com
"Produto salvo." na tela — aconteceu de verdade com um produto do piloto
durante a verificação de outro fix nesta mesma sessão. Fix: `openForEdit`
único no cliente (sempre busca o produto inteiro via `getProductFn` antes
de abrir), e no servidor só sobrescreve description/category_id/brand_id/
supplier_id/variantes quando o cliente realmente mandou algo — senão
preserva o que já está gravado. Editar sem tocar na grade agora não toca
em `product_variants` de jeito nenhum.

O produto afetado no piloto (`Camiseta Algodão Premium`, id 37, empresa
4/"Victor Comércio") já está **totalmente restaurado**: categoria e
descrição pela própria tela, marca/fornecedor/`has_variants`/SKU e
código de barras da variante Preta/P (id 58) por SQL direto autorizado
explicitamente pelo usuário, com transação, before/after conferido e
commit — todos os campos batendo com as três cópias idênticas do mesmo
produto seed noutras empresas.

**Classe de bug "Number() em campo de dinheiro sem `type=\"number\"`"**:
uma varredura dedicada achou o mesmo padrão em oito lugares — texto livre
convertido com `Number()` puro aceita formato brasileiro ("1.200" = mil e
duzentos) e devolve um numero ERRADO mas VALIDO (1.2), não `NaN`, então
não cai em nenhuma checagem de "valor inválido" existente. Todos
corrigidos com `type="number"` (bloqueia o formato ambíguo no próprio
input do navegador) ou `parseMoneyInput` onde o campo já tinha esse
padrão: sangria/suprimento do caixa (`caixa.tsx`), preço promocional do
produto (`produtos.tsx` — promoção nunca aplicava, ficava presa em NaN→0),
frete e custo unitário do pedido de compra (`compras.tsx` — o custo
unitário errado ainda contamina o custo do produto ao receber), valor da
meta (`metas.tsx` — com bônus fixo configurado, pagava na primeira venda
que passasse de R$15 em vez de R$15.000). `saveProductFn` e
`savePromotionFn` também ganharam validação server-side (mesmos
`parseUnitCost`/checagem de finitude já usados em `savePurchaseFn`) —
"validação de tela não vale pra quem chama o servidor direto".

**Filtro de vendedor do painel não afetava hoje/mês/tendência/produtos**
(`insight.ts`, `dashboardFn`): o painel tem um único seletor "Vendedor" no
topo, controlando visualmente a tela inteira, mas só "Faturamento do
período" (`kpiScope`) e o gráfico "Vendas do período" (`seriesScope`) de
fato o respeitavam. "Faturamento hoje", "Faturamento do mês", a tendência
de 12 meses e "Produtos mais vendidos" só filtravam por loja, ignorando o
vendedor selecionado — dois números de escopos diferentes lado a lado
(ex.: "do mês" mostrando a loja inteira enquanto "do período" já mostrava
só o vendedor). Corrigido adicionando `s.seller_id` aos quatro escopos que
faltavam; `sellerScope` (ranking "Vendedores") continua sem o filtro de
propósito — é comparação entre vendedores, não faria sentido reduzida a
um só. Confirmado ao vivo contra o piloto: com "João Martins" selecionado,
"do mês" e "do período" passaram a bater, e "Produtos mais vendidos"
passou a mostrar só o item que ele vendeu.

**Três dos cinco tipos de promoção nunca davam desconto nenhum**
(`promocoes.tsx`): o diálogo só perguntava Percentual/Quantidade mínima,
mas o seletor de Tipo oferece Fixo/Preço promocional/Leve X pague Y — os
três precisam de um valor que o formulário nunca perguntava. Uma promoção
desses tipos salvava "Ativa" e nunca aplicava desconto, silenciosamente,
desde sempre. Corrigido com campos condicionais por tipo + validação.

**Inscrição Estadual não podia ser apagada, e UF sem validação**
(`session.ts`, `saveCompanyFn`): `ie` usava `coalesce(novo, ie)` — único
campo de texto do formulário de empresa com esse comportamento — então
limpar o campo nunca gravava, silenciosamente. UF só cortava em 2
caracteres sem validar maiúscula/formato ("São Paulo" → "Sã"). Ambos
corrigidos.

**CFOP cortado em 4 caracteres em vez de validado**: mesmo bug já
corrigido no NCM (ver "O que já está feito" — busca por `parseNcm` acima),
no campo vizinho. `parseCfop` agora aceita "5.102"/"5 102"/"5102" e exige
4 dígitos, com o mesmo padrão de `parseNcm` (`src/lib/ncm.ts`).

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

"Contas a receber"/"Contas a pagar" ignoravam o seletor de loja do topo
(`app-shell.tsx`, escopa a tela inteira via `useSelection`). `accounts_
receivable`/`accounts_payable` têm `store_id` desde o schema original, mas
as somas no `dashboardFn` (`insight.ts`) e em "resumo"/"pagar"/"receber"/
"aging" (`reports.ts`) nunca filtravam por ele — somavam a empresa inteira
mesmo com uma loja específica selecionada. Confirmado com as duas lojas
reais do piloto: selecionar "Loja Shopping" mostrava o dinheiro inteiro da
"Loja Centro" (R$1.139,90 a receber, R$6.715,00 a pagar) nos dois lugares.
Corrigido com o mesmo padrão `andEq`/`($n::int is null or store_id = $n)`
já usado no resto dessas funções; verificado ao vivo no Dashboard e em
Relatórios antes/depois, batendo com consulta direta ao Postgres.

Mesma família de bug, achada em seguida em `financeiro.tsx`: `listExpensesFn`
não recebia `storeId` nenhum (só `listPayablesFn`/`listReceivablesFn`/
`cashflowFn` recebiam), então o card "Saídas" (escopado por loja) e a aba
"Despesas" logo abaixo — sem coluna nenhuma indicando de onde vinha cada
lançamento — podiam mostrar números que não batiam. Confirmado no piloto:
as duas despesas reais (Energia R$640, Marketing R$320) são da Loja Centro;
selecionar Loja Shopping zerava o card mas a tabela continuava as listando.
Corrigido dando `storeId` pra `listExpensesFn` (GET virou POST com
validator, mesmo padrão das funções irmãs) e passando o seletor atual do
`useSelection` na chamada.

`cancelSaleFn` (commerce.ts) so recusava status `'cancelada'` -- uma venda
`devolvida`/`devolvida_parcial` passava direto. A tela so mostra "Cancelar
venda" com status `'finalizada'`, mas isso e checagem de tela, nao vale pra
quem chama a funcao do servidor direto (mesmo principio do `cashMoveFn`).
O estorno de estoque le a quantidade ORIGINAL de `sale_items` sem descontar
o que `return_items` ja tinha creditado numa devolucao parcial anterior --
cancelar depois de uma devolucao parcial duplicava a peca ja devolvida no
estoque. Confirmado com transacao revertida (cenario sintetico: venda de 2
unidades, 1 ja devolvida, cancelSaleFn devolveria 2 ao estoque). Corrigido
bloqueando o cancelamento fora de `'finalizada'`, igual a tela ja fazia.

Vazamento de dado de folha pro papel "vendedor" (party.ts, `listSellersFn`):
"vendedor" e o UNICO papel com `sellers.read` mas sem `sellers.write`
(confirmado programaticamente pros 7 papeis). A tela /app/vendedores mostra
CPF na lista e salario mensal no dialogo de Editar sem checagem de papel
nenhuma -- so a escrita (`saveSellerFn`) exigia `sellers.write`; a leitura
so pedia `sellers.read`. Ou seja, convidar alguem com o papel normal de
"vendedor" deixava essa pessoa ver CPF, regime tributario e salario de
TODOS os colegas vendedores -- mesma classe de vazamento que
`listActiveSellerNamesFn` ja existe pra evitar do lado do papel "pdv".
Corrigido redigindo document/monthly_salary/dependents/iss_rate/tax_regime
quando quem pede nao tem `sellers.write`, deixando so o que ja aparece pro
Dashboard (nome, faturamento, comissao, pendente). Confirmado ao vivo que
admin continua vendo tudo normalmente.

Mesmo furo de sellers.read x sellers.write, achado em mais DUAS portas
depois de fechar a de listSellersFn: `retentionGuideFn` (retention.ts --
guia de retencoes: CPF, bruto, INSS/IRRF/ISS, liquido e custo patronal de
CADA vendedor numa tabela imprimivel) e `listCommissionsFn` (finance.ts --
aba "Pagamentos", filtro "Todos os vendedores" + liquido e detalhamento de
imposto por comissao, historico inteiro sem limite de data). Nenhuma das
duas tem versao "reduzida" que faca sentido pra quem so vende, entao os
dois foram trocados pra exigir `sellers.write` (so admin/gerente) em vez de
redigir campo por campo. Confirmado programaticamente que `sellers.write`
pertence so a admin/gerente entre os 7 papeis, e testado ao vivo que admin
continua vendo as duas abas completas. Varredura final por todo `sellers.read`
no codigo confirma que so sobra a excecao ja documentada em
`simulateCommissionFn` (simulacao de UMA venda, sem listar dado de outros
vendedores -- correta).

Quarta porta do mesmo furo: `getSaleFn` (commerce.ts) so exige `sales.read`
("vendedor"/"caixa"/"financeiro" tem sem `sellers.write`), e a tela de
Vendas deixa abrir QUALQUER venda da empresa -- o dialogo de detalhe sempre
mostrava liquido e INSS/IRRF/ISS da comissao daquele vendedor, venda por
venda. Diferente das outras tres, aqui `sales.read` precisa continuar
aberto pras tres funcoes (cancelar, historico, comprovante), entao so os
campos de folha (net/taxInss/taxIrrf/taxIss/taxOther/taxBreakdown) foram
redigidos quando quem pede nao tem `sellers.write` -- `amount`/`percent`
(quanto a venda gerou de comissao bruta) continuam visiveis, mesmo nivel de
`commission_pct`/`month_revenue` que o ranking do Dashboard ja mostra.
Testado ao vivo: venda com comissao de Joao Martins (autonomo) continua
mostrando o detalhamento completo pra quem tem `sellers.write`.

Varredura sistematica por TODOS os pares leitura/escrita do sistema
(products, customers, suppliers, cash, targets, users) nao achou mais
nenhum caso do mesmo padrao -- as outras exposicoes (custo do produto pra
vendedor/caixa, CPF do cliente pra caixa/pdv, etc.) sao necessidade real do
trabalho de cada papel, nao vazamento: diferente de CPF/salario de
FUNCIONARIO, que e categoria protegida por lei, nao decisao de produto.

`resolvePeriod` (period.ts) calculava o periodo anterior sempre um dia mais
largo que o atual -- `days` somava `round((end-start)/86400000) + 1`, certo
pra fronteiras meia-noite-a-meia-noite, mas `end` aqui e fim de dia
(23:59:59.999), entao o "+1" ja era demais. "Ontem" (1 dia) comparava contra
um periodo anterior de 2 dias; "Ultimos 7 dias" contra 8; um mes de 31 dias
contra 32 -- em todo PeriodKey. So afeta o Dashboard (`insight.ts` e o unico
que le `range.prevFrom/prevTo`; `reports.ts` tem seu proprio `prevWindow()`,
sem o bug). Confirmado com dado real do piloto: no filtro "Ultimos 7 dias",
o dia incluido a mais tinha 3 vendas somando R$289,70, inflando a base do
"vs periodo anterior" e mostrando crescimento menor (ou queda maior) do que
o real. Corrigido trocando o calculo manual por `differenceInCalendarDays`
(date-fns); testes novos em `period.test.ts`.

Removida `storeClause` (context.ts): nunca era chamada em lugar nenhum, e o
placeholder que montava (`$SID`) nao e um parametro valido do Postgres --
quebraria se algum dia fosse usada. Codigo morto e incorreto ao mesmo tempo,
sem impacto hoje.

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

3. ~~Migration 0022_nfce_foundation registrada sem arquivo~~ — **resolvido**:
   `migrations/0029_drop_nfce_foundation.sql` criado e aplicado contra o
   banco real (commit 7bb2c5b). `npm run db:migrate` confirmado limpo
   ("up to date", sem aviso).

4. ~~Decisão do usuário: apagar ou não os dados de demonstração do piloto~~
   — **resolvido**: a empresa #4 ("Victor Comércio") nunca teve uso real
   (todo mundo criado no mesmo segundo, vendas com data anterior à criação
   da empresa, zero venda/pagamento/recebimento no log de auditoria — só um
   punhado de edições de produto). Confirmado com o usuário e removido: 389
   linhas em 32 tabelas (vendas, clientes, produtos, vendedores,
   fornecedores, promoções, metas, regras de comissão, caixa de
   demonstração aberto, etc.), com dry-run prévio (transação com rollback)
   mostrando a contagem exata antes de aplicar de verdade. Ficou intacto de
   propósito: as duas lojas (Loja Centro/Shopping — renomeie se quiser),
   o login do admin, as 5 contas de caixa e os 9 registros reais de
   auditoria. Os contadores de numeração (venda/compra) foram zerados, a
   próxima venda real começa do nº 1. Confirmado ao vivo que Dashboard e
   Produtos renderizam certo com a base zerada (telas de "nenhum dado"
   aparecendo como esperado, sem erro).

5. ~~Promoções sem estado vazio~~ — **corrigido** (commit 682936b): com a
   lista de promoções vazia, a página mostrava uma tabela em branco (só
   cabeçalho, sem call-to-action) e não tratava `list.error` — inconsistente
   com Clientes/Fornecedores/Compras/Estoque/Devoluções/Metas, que já usam
   `EmptyState`. Descoberto varrendo todas as 17 rotas de `src/routes/app`
   ao vivo contra o banco recém-limpo do item 4 (era a única página sem
   mensagem amigável de "nada aqui ainda"). Aplicado o mesmo padrão das
   outras páginas.

6. ~~Tabela `expenses` fora da lista do script de limpeza do item 4~~ —
   **resolvido**: as duas linhas de demonstração da empresa #4 (energia
   elétrica R$640 + anúncio R$320, mesmo carimbo de data/hora do resto dos
   dados de demo já removidos) foram apagadas depois que o usuário
   autorizou explicitamente pelo chat (o classificador de segurança do
   Auto Mode tinha bloqueado a remoção automática antes — mesmo tipo de
   bloqueio que a migration 0029 teve duas vezes). Confirmado
   `select count(*) from expenses where company_id = 4` = 0 e "SAÍDAS" no
   Financeiro voltou a R$ 0,00 ao vivo.

7. ~~Contas a pagar/a receber/Despesas sem estado vazio~~ — **corrigido**
   (commit d503c10): mesma classe de bug do item 5, achada na mesma
   varredura — as três tabelas do Financeiro renderizavam só o cabeçalho,
   sem linha e sem mensagem, quando a consulta voltava vazia. Aplicado o
   mesmo `EmptyState` das outras páginas, com CTA por aba. Confirmado ao
   vivo nas três abas contra o banco zerado; `npm test` 417/417.

8. ~~Equipe/Pagamentos (Vendedores) sem estado vazio~~ — **corrigido**
   (commit 2e1e58b), fechando a varredura da mesma classe: depois de achar
   a falha em Promoções e Financeiro, procurei TODO uso de `<DataTable`
   no projeto (`grep -rln "<DataTable" src`, 15 arquivos) atrás do mesmo
   padrão. As abas Equipe e Pagamentos de Vendedores tinham o mesmo furo;
   os outros 4 arquivos (`retention-guide.tsx`,
   `purchase-suggestion-panel.tsx`, `stock-count-panel.tsx`,
   `commission-panel.tsx`) já tratavam a lista vazia (mensagem própria ou
   `EmptyState`) — conferido um por um. Com isso a classe "tabela em
   branco sem mensagem" está fechada em toda a base, não só nas 17 rotas.

9. ~~Promoção mal cadastrada podia gerar linha de venda negativa~~ —
   **corrigido** (commit a8f9ec5): `computePromo` (`src/lib/promo.ts`) não
   tinha teto — um percentual digitado errado (ex.: 500 no lugar de
   50,0%) ou preço promocional negativo geravam desconto MAIOR que a
   própria linha, e `checkoutFn` aplica `unitPrice*qty - desconto` sem
   clamp. O `if (total < 0)` de lá só olha a venda inteira, não cada
   linha — com mais de um item a soma podia fechar positiva mesmo com uma
   linha corrompida, finalizando a venda de verdade com subtotal errado.
   Provado com teste puro antes do fix (percent=500 numa linha de 2x
   R$100 → linha de -R$800). Fix em duas camadas: teto em `computePromo`
   (protege qualquer promoção já salva) + validação em `savePromotionFn`
   (erro claro no cadastro: "Percentual deve estar entre 0 e 100.",
   testado ao vivo). Novo `src/lib/promo.test.ts`, 6 casos. `npm test`
   423/423.

10. **Validação ponta a ponta do PDV, ao vivo, contra a empresa #4 real**:
    depois de tanta leitura de código, testei o caminho de dinheiro de
    verdade — não com dados falsos permanentes, com dados descartáveis
    criados, exercitados pelo PDV de verdade e apagados por completo
    depois (autorizado pelo usuário nos dois pontos: criar e depois
    apagar). Criei 1 produto + variante, 1 vendedor e 1 promoção de 20%
    "TESTE E2E (apagar)", abri o caixa da Loja Centro, e vendi 1 peça
    pelo PDV com pagamento dividido (R$50 dinheiro + R$30 débito Visa).
    Conferido linha por linha contra o banco: venda total R$80,00 (100 −
    20% de promoção, a MESMA conta que o item 9 corrigiu), comissão
    R$8,00 (10% do pós-promoção, correto), estoque 10→9 com
    `stock_movements` registrado, os dois pagamentos lançados em
    `cash_movements`, e o débito virou `accounts_receivable` pendente
    pro dia seguinte. Tudo bateu exatamente com o esperado — nenhum bug
    novo neste caminho. Limpeza depois: sale, itens, pagamentos,
    comissão, recebível, movimento de caixa, produto/variante/vendedor/
    promoção de teste, o caixa aberto pro teste e as entradas de
    `audit_logs` do teste — tudo apagado, `company_counters` da venda
    devolvido pra 0 (a próxima venda real volta a ser nº 1). Confirmado
    ao vivo depois: Vendas/PDV/Produtos/Vendedores voltaram a "nenhum
    dado", igual antes do teste.

    Nota à parte, não é bug do produto: o servidor de dev (`npm run dev`)
    caiu sozinho uma vez no meio do teste (código de saída
    `3221226505` = `0xC0000409`, um crash de processo do Windows/Node,
    não um erro da aplicação) bem no primeiro request de busca do PDV
    depois de reiniciar o preview. Reiniciou limpo e o resto do teste
    rodou sem repetir. Parece falha do ambiente de preview local, não do
    `gestao-comercial` — mas se voltar a acontecer, vale investigar.

11. **Validação ponta a ponta do fechamento de caixa, ao vivo**: mesma
    lógica do item 10, agora no fluxo diário mais crítico da loja. Com 1
    produto descartável, abri o caixa (fundo R$100), vendi 1 peça de
    R$50 em dinheiro, lancei um suprimento de R$20 ("reforço de troco")
    e uma sangria de R$30 ("depósito no banco"), depois fechei contando
    R$145,00 de propósito (R$5 a mais do que bateria). O sistema calculou
    esperado = 100 + 50 + 20 − 30 = **R$140,00** — exatamente certo — e
    sinalizou a diferença de R$5,00 como "precisa de explicação" (acima
    da tolerância de R$2 em `CASH_DIFFERENCE_TOLERANCE`). Registrei a
    explicação e confirmei no banco: `difference_reason` e
    `difference_explained_at` gravados corretamente, os três
    `cash_movements` (venda/suprimento/sangria) certos. Nenhum bug módulo
    de caixa — abertura, sangria/suprimento, fechamento cego e explicação
    de diferença todos corretos. Limpeza completa depois (venda, seus
    itens/pagamentos, os movimentos de caixa, o caixa fechado de teste,
    o produto/variante/estoque descartável, `audit_logs` do teste,
    `company_counters` devolvido pra 0), confirmada ao vivo.

12. ~~Devolução parcial em venda mista dava reembolso em dobro~~ —
    **corrigido** (commit 3a9dffe): achado auditando `createReturnFn` a
    pedido do usuário (fluxo de devolução). Numa venda paga por mais de um
    meio (dinheiro + crediário, ou dinheiro + cartão parcelado), o
    abatimento em cascata das parcelas em aberto e o reembolso em
    dinheiro usavam a MESMA variável `total` (valor devolvido)
    independentemente um do outro — a devolução perdoava o valor inteiro
    nas parcelas E devolvia o mesmo valor em espécie. Provado com teste
    puro antes do fix: venda de R$150 (R$100 dinheiro + R$50 em crediário
    2x) devolvendo o item de R$50 perdoava as duas parcelas E devolvia
    R$50 em dinheiro — R$100 de valor por uma devolução de R$50. Fix: o
    reembolso em dinheiro agora usa `restanteDevolucao` (o que sobra
    depois do abatimento das parcelas), não `total` — em venda 100% à
    vista não muda nada, só corrige o caso misto. Reproduzido ao vivo com
    dados descartáveis (venda real de R$75, R$50 dinheiro + R$25 em
    crediário 2x, devolvendo o item de R$25): confirmado no banco que as
    parcelas foram canceladas e nenhum movimento de caixa de devolução
    foi criado. `npm test` 423/423, dados de teste removidos por completo.

13. ~~Devolução após recebimento parcial deixava recebível inconsistente~~
    — **corrigido** (commit ac71667), mesma auditoria do item 12: se uma
    parcela de crediário/cartão já tinha sido PARCIALMENTE recebida pela
    Cobrança antes da devolução, o abatimento zerava `amount` pelo valor
    cheio sem tocar `received_amount` — título ficava com "recebido maior
    que o valor", escondendo dinheiro que a loja ficou devendo pro
    cliente. Fix: só perdoa o que ainda não foi pago
    (`amount - received`), nunca o valor cheio. **Limitação que
    continua**: se o já recebido veio de PIX/cartão lançado na própria
    Cobrança (não dinheiro), o sistema não tem como saber e não estorna
    sozinho — não existe coluna amarrando `received_amount` ao método de
    cada recebimento parcial. Fica manual com a loja nesse caso
    específico; documentado no código. Reproduzido ao vivo (parcela de
    R$25, R$10 recebidos, devolução total): título foi para
    amount=10/received=10/pago (consistente), não mais
    amount=0/received=10/cancelado. `npm test` 423/423.

14. ~~Entradas do fluxo de caixa contava venda no cartão/crediário em
    dobro~~ — **corrigido** (commit 405159a), achado testando ao vivo a
    conciliação de cartão (aba Cartões, nunca exercida antes nesta
    sessão): `cashflowFn` somava toda venda por forma de pagamento
    (`salesIn`) E, separadamente, cada liquidação/cobrança recebida
    (`extraIn`) — sem excluir do primeiro o que o segundo ia contar
    depois. Cartão e crediário não viram dinheiro no dia da venda, só na
    liquidação/cobrança. Reproduzido ao vivo: venda de R$100 no crédito
    (taxa 3%, líquido R$97) mostrava "Entradas R$100,00"; ao confirmar a
    liquidação na aba Cartões, pulou pra R$197,00 (deveria ficar em
    R$97,00). Fix: `salesIn` agora exclui débito/crédito/crediário — a
    quebra por forma de pagamento da aba Fluxo de caixa continua
    mostrando todos os métodos normalmente (ali o interesse é outro:
    "quanto se vendeu por forma"). Confirmado ao vivo que "Entradas"
    voltou a R$97,00 depois do fix. `npm test` 423/423.

15. **Auditoria de prontidão operacional (backup e segurança), a pedido do
    usuário** — sem código mudado, mas com evidência real, não só leitura:
    - **Backup: PROVADO que restaura.** Esta própria máquina é a instalação
      piloto de verdade (`C:\ProgramData\GestaoComercial` existe aqui) —
      rodei `Restore-GestaoComercial.ps1 -Ensaio` contra o backup real mais
      recente (`gestao_comercial_20260929_223019.dump`). Restaurou 47
      tabelas, 145 índices e 183 constraints num schema descartável dentro
      de uma transação com ROLLBACK (nada foi alterado). As duas únicas
      divergências de contagem (`company_counters`, `notifications`) são
      esperadas — atividade real depois do backup, não corrupção. A tarefa
      agendada (`GestaoComercial-Backup`, 22:30 diário) está rodando de
      verdade: histórico de dumps de 19/09 até 29/09 em
      `C:\ProgramData\GestaoComercial\backups`.
    - **PENDENTE, decisão do usuário: sem cópia fora da máquina.**
      `last-backup.json` não tem campo `secondary` — nenhum
      `SecondaryDir` foi configurado (`Set-BackupSecondaryDir.ps1`
      existe pronto pra isso). Hoje, se o disco desta máquina falhar,
      banco E backups somem juntos. Falta o usuário decidir ONDE (HD
      externo, pendrive, pasta de rede, OneDrive local) — isso não dá
      pra escolher por ele.
    - **Segurança de convite/sessão: auditado, nada de novo encontrado.**
      `ensureTenant` (`src/lib/server/context.ts`) só deixa criar empresa
      nova quando o banco está genuinamente vazio (comentário no código
      já documenta um bug de escalação de privilégio consertado antes:
      "qualquer conta sem convite ganhava empresa própria"); todo o resto
      exige convite com token hasheado e validade. `acceptInvite` pega o
      papel (role) SÓ do convite gravado pelo admin, nunca de entrada do
      cliente. `updateMemberFn` bloqueia auto-desativação e bloqueia
      remover o último admin. Não achei brecha nova. A maior parte de
      `src/lib/auth/*` (bearer token, CSRF, isolamento same-site) é
      andaime de plataforma compartilhado entre apps, não código
      específico do gestão comercial — não auditado a fundo por já ser
      superfície de terceiro, presumivelmente já revisada em outro nível.

16. **Bônus de meta (crossing) testado ao vivo — confirmado correto,
    nenhum bug**: meta de R$150 com bônus fixo de R$20 ao cruzar
    (`extra_fixed`), 3 vendas de R$100 de um vendedor descartável. Era o
    ponto mais propenso a bug (condição de fronteira, igual ao off-item
    do período e ao tolerance do caixa que já renderam bug real nesta
    sessão): venda 1 (R$0→R$100, não cruza) comissão R$10; venda 2
    (R$100→R$200, cruza os R$150) comissão R$30 (R$10 + bônus R$20);
    venda 3 (R$200→R$300, já cruzou) comissão R$10 de novo, sem repetir o
    bônus. Todas as três batidas exatamente com o esperado, confirmado no
    banco (`commissions.amount`/`note`). `applyTargetBonuses`
    (`src/lib/commission.ts`) está correto.

17. **Compras testado ao vivo — recebimento correto, mas achado um gap de
    metodologia de custo (não é bug, é decisão do usuário)**: criei um
    pedido de 10 unidades a R$50 + R$100 de frete (total R$600), recebi.
    Confirmado no banco: estoque 5→15, `accounts_payable` R$600,00
    vencendo em +14 dias — tudo certo. Mas o CUSTO gravado no produto
    ficou em R$50,00 (só o `unit_cost` digitado), sem ratear o frete —
    o custo real de aterrissagem era R$60/unidade (500+100)/10. O frete
    entra corretamente no que a loja DEVE ao fornecedor, mas nunca entra
    no CMV/margem que Dashboard e DRE calculam depois: toda venda futura
    deste produto vai superestimar o lucro em R$10/unidade até a próxima
    compra atualizar o custo. Não é um cálculo errado isolado — é uma
    escolha de metodologia contábil (ratear frete no custo do estoque vs.
    tratar como despesa do período) que só o usuário/contador deve
    decidir, por isso não mexi. Se decidir ratear, o lugar é
    `receivePurchaseFn` (`src/lib/server/catalog.ts`), que hoje faz
    `update products set cost = unit_cost` direto, ignorando
    `purchases.freight`/`tax`/`discount`.

18. ~~saveCustomerFn resetava o estágio do CRM pra "Venda" ao omitir
    crmStage~~ — **corrigido** (commit 9656789), achado testando o CRM.
    `crm_stage = data.crmStage ?? "venda"` na atualização: qualquer edição
    de cliente sem informar o estágio (campo opcional no validador)
    teleportava o cliente pro estágio "Venda", apagando o progresso real
    do funil. Não explorável pelas duas telas atuais (`clientes.tsx` só
    cria; `customer-panel.tsx` já manda o estágio certo), mas o contrato
    da função permitia omitir — a próxima tela que editasse cadastro sem
    mexer no CRM caía na armadilha. Fix:
    `crm_stage = coalesce(crmStage, crm_stage)`. Verificado com a chamada
    exata (crmStage nulo) contra cliente descartável em "negociação":
    telefone mudou, estágio ficou intacto. Regressão checada ao vivo no
    painel real do CRM. `npm test` 423/423.

    Enquanto estava ali, corrigido também `moveCrmFn` (mesmo arquivo): não
    validava `data.stage` contra `CRM_STAGES` — um valor arbitrário
    gravaria direto e o cliente sumiria de todas as colunas do funil.
    Baixo risco (só a própria empresa é afetada, a tela sempre manda um
    valor válido), mas mesma fragilidade do achado acima. Adicionado
    `isCrmStage` (`src/lib/constants.ts`, mesmo padrão de `isRole`/
    `isCardMethod`) e o guard em `moveCrmFn`. Testado ao vivo: mover o
    card pelo select do quadro continua funcionando normalmente.

19. **"Leve X pague Y" testado ao vivo pelo checkout real — confirmado
    correto**: fechando o ciclo do fix do item 9 (que corrigiu o teto de
    desconto pra todo tipo de promoção, mas só tinha sido testado ao vivo
    com percentual). Promoção "leve 3 pague 2", 5 peças de R$20 no
    carrinho: subtotal R$100, desconto R$20 (exatamente 1 peça grátis —
    um grupo completo de 3, as 2 sobrando não formam outro grupo), total
    R$80. Confirmado no banco (`sale_items.discount` = 20.00,
    `sales.total` = 80.00). Nenhum bug — `computePromo`'s branch `bxgy`
    (`src/lib/promo.ts`) está correto na prática, não só no teste
    unitário.

20. **"Desconto por quantidade" testado ao vivo — confirmado correto,
    inclusive no limiar exato**: fecha o ciclo dos três tipos de promoção
    (percentual, leve-X-pague-Y, quantidade) todos validados pelo
    checkout real depois do fix do item 9. Promoção "5 ou mais, 10% off",
    produto de R$20: com 4 peças no carrinho, sem desconto (R$80,
    correto — abaixo do mínimo); com 5 peças, desconto de R$10 (10% de
    R$100), total R$90. O limiar `qty >= minQty` bate exatamente onde
    deveria, sem passar nem faltar um. Confirmado no banco
    (`sale_items.discount` = 10.00). Nenhum bug.

21. **Transferência de estoque entre lojas testada ao vivo — confirmada
    correta**: 8 unidades de um produto descartável saindo da Loja Centro
    (20→12) e chegando na Loja Shopping (0→8) pela tela de Estoque >
    Ajustar > "Transferir para loja". Os dois `stock_movements`
    (`-8`/`+8`) gravados atomicamente, saldos batendo exatamente dos dois
    lados. Nenhum bug — `transferStockFn` (`src/lib/server/catalog.ts`)
    correto na prática.

22. **Regra de comissão por categoria testada ao vivo — confirmada
    correta**: vendedor descartável com padrão 10%, regra específica de
    3% pra categoria "Eletrônicos". Venda de R$100 num produto dessa
    categoria gerou comissão de R$3,00 (a regra de categoria venceu o
    padrão do vendedor, como `ruleSpecificity` prevê). Confirmado no
    banco (`commissions.amount` = 3.00, `percent` = 3.00). Nenhum bug —
    `pickRule`/`ruleMatches`/`ruleSpecificity` (`src/lib/commission.ts`)
    corretos na prática, não só no design.

    Nota de processo: o primeiro teste testou sem querer contra a Loja
    Shopping (o seletor de loja tinha ficado nela de uma rodada anterior
    — não reiniciei a seleção, não é bug do produto), gerando um caixa
    órfão lá além do de Loja Centro. Os dois foram limpos; confirmado ao
    vivo que ambas as lojas voltaram a "Nenhum caixa aberto".

23. **Guardar/Recuperar (venda em espera) testado ao vivo — correto —
    mas achado um risco real de venda em dobro no checkout, sem
    idempotência**: o hold/resume em si funciona perfeitamente
    (`holdSaleFn`/`resumeHeldFn`, `src/lib/server/commerce.ts`) —
    guardei uma venda, recuperei, o carrinho voltou exato e a linha de
    `held_sales` foi consumida uma única vez, confirmado no banco.

    O achado sério veio DEPOIS: ao finalizar a venda recuperada, a aba
    do navegador travou sem mostrar confirmação logo após um erro de
    rede transitório ("Failed to fetch" no `checkoutFn`). Achando que
    tinha falhado, abri uma aba nova e refiz a venda inteira. Resultado
    no banco: **duas vendas de verdade** para o mesmo item (nº 1 e nº 2,
    R$50 cada, mesma variante), estoque baixado duas vezes (10→8). A
    primeira tentativa TINHA dado certo no servidor — só a tela não
    confirmou. Reproduzido sem querer, não é hipotético.

    Isto expõe uma lacuna real e séria: **`checkoutFn` não tem proteção
    contra reenvio** (nenhuma chave de idempotência). Se a resposta de
    rede falhar bem na hora em que a venda já foi gravada, o operador não
    tem como saber que deu certo — e a reação natural (recarregar a tela,
    tentar de novo) vende a mesma coisa duas vezes pro cliente de
    verdade, com pagamento cobrado em dobro.

    **PENDENTE, decisão do usuário**: não implementei a correção porque
    mexe no contrato da API de checkout (`checkoutFn` seria a peça a
    mudar, junto com uma coluna nova pra guardar a chave de idempotência
    do lado do cliente, ex. um UUID gerado no início de cada venda) e
    provavelmente precisa de migração — é uma mudança de arquitetura, não
    um ajuste pontual. Dados de teste (2 vendas, estoque, produto,
    caixas) completamente revertidos depois.

24. **Idempotência do checkout — implementada, migrada e provada ao vivo**
    (autorizado pelo usuário, item 23 acima): `checkoutFn` agora recebe
    `idempotencyKey` (UUID gerado uma vez por tentativa de fechamento no
    `pdv.tsx`, via `checkoutKey` ref, reenviado igual em cada retry da
    MESMA tentativa — só zera numa venda nova de verdade, em `novaVenda()`).

    `migrations/0031_sale_idempotency.sql` adiciona `sales.idempotency_key`
    com índice único parcial `(company_id, idempotency_key) where
    idempotency_key is not null` — mesmo padrão de `document`/`barcode` em
    0020. Já aplicada no banco real (`npm run db:migrate`), confirmada via
    `information_schema`/`pg_indexes`.

    No servidor (`src/lib/server/commerce.ts`): antes de processar, se
    `idempotencyKey` já bate com uma venda existente, devolve o mesmo
    comprovante (`buildCheckoutReceipt`, reconstrói a resposta a partir de
    `sales`/`sale_items`/`payments`/`commissions`) em vez de reprocessar o
    carrinho. Corrida rara (duas requisições com a mesma chave quase juntas)
    é pega no `catch` pelo código `23505` do índice único e também devolve
    o comprovante já gravado, em vez de erro.

    **Provado ao vivo, não só por leitura de código**: abri o PDV real,
    criei produto descartável, fiz uma venda normal pela UI (nº 1), depois
    importei o módulo `commerce.ts` já carregado pelo Vite no console do
    navegador e chamei `checkoutFn` DUAS VEZES com o mesmo payload e a
    mesma `idempotencyKey` — reproduzindo exatamente o cenário do item 23
    (cliente reenviando a mesma tentativa). Resultado: as duas chamadas
    devolveram a MESMA venda (id 234, nº 2); conferido no banco que só
    existe UMA linha em `sales` com aquela chave e só UM `stock_movements`
    para aquela venda (estoque 10→9 na venda nº1, 9→8 na nº2 — nunca 9→7
    nem duas vendas nº 2). `npm run typecheck`, `npm run lint` e `npm test`
    (423 testes) limpos. Dados de teste revertidos depois.

25. **Cancelamento de venda testado ao vivo pelo fluxo real — confirmado
    correto, nenhum bug**: até agora `cancelSaleFn` só tinha sido verificado
    por leitura de código e uma transação sintética revertida (ver item,
    acima, sobre o bug de devolução parcial + cancelamento já corrigido em
    sessão anterior) — faltava o caminho feliz de ponta a ponta pela tela de
    verdade. Fiz uma venda mista pelo PDV real (R$60 dinheiro + R$40
    crediário, com vendedor e cliente atribuídos, comissão de 10%) e
    cancelei pela tela de Vendas.

    Tudo bateu no banco: estoque voltou exatamente 9→10 (um
    `stock_movements` tipo `venda` e um `devolucao`, sem duplicar — a
    correção anterior de "cancelar depois de devolução parcial" continua
    válida); o título de crediário (`accounts_receivable`) foi para
    `cancelado`; a comissão foi para `cancelado` sem apagar o valor
    histórico; e o estorno de caixa (`dinheiroAindaNaVenda`) lançou um
    `cash_movements` do tipo `cancelamento` de **R$60,00 só em dinheiro** —
    não os R$100 cheios, excluindo corretamente a parcela de crediário que
    nunca tinha entrado na gaveta. Notificação e `audit_logs` (`create` +
    `cancel`) também corretos. Dados de teste (1 venda, 1 produto, 1
    vendedor, 1 cliente, 1 caixa) revertidos por completo depois.

    Nota de processo: a janela do navegador usada nesta rodada renderizou
    com um viewport bem menor que o normal (490×261) e o `resize_window`
    não conseguiu corrigir — contornado operando por `read_page`/JS direto
    em vez de depender de screenshot/coordenadas. Sem relação com o
    produto, só com a ferramenta de automação do navegador nesta sessão.

26. **Contagem de estoque (inventário) testada ao vivo pelo fluxo real —
    confirmado correto, nenhum bug, inclusive no cenário de maior risco**:
    `applyStockCountFn` (`src/lib/server/stock-count.ts`) só tinha leitura
    de código a favor dele até agora. A promessa do comentário no código é
    específica: "ao aplicar, lança-se a DIFERENÇA encontrada, não o contado
    como saldo absoluto — senão toda venda feita entre contar e aplicar é
    desfeita". Testei exatamente essa promessa, não só o caminho feliz.

    Contei 2 produtos descartáveis (estoque 10 cada): um ficou com falta
    (contado 8, diferença −2) e outro com sobra (contado 13, diferença +3).
    **Antes de aplicar**, vendi 1 unidade do produto com falta pelo PDV de
    verdade — simulando uma venda real acontecendo durante a janela entre
    contar e aplicar, que é justamente o cenário que a função promete
    proteger. Estoque desse produto foi para 9 por causa da venda. Apliquei
    o inventário depois.

    Resultado conferido no banco: `stock_movements` mostra a venda (10→9)
    e, por cima dela, o ajuste de inventário aplicando a DIFERENÇA (−2)
    sobre o saldo ATUAL — 9→**7**, não 9→6 (dobro) nem 10→8 (que teria
    apagado a venda real tratando o contado como absoluto). O produto com
    sobra foi de 10→13 (diferença +3) normalmente. `stock_counts.status`
    foi para `aplicado`, e `audit_logs` registrou `ajustados: 2, sobras: 3,
    faltas: 2`, batendo exato com os dois itens. Dados de teste (1
    inventário, 2 produtos, 1 venda, 1 caixa) revertidos por completo
    depois.

27. **Devolução TOTAL com pagamento misto testada ao vivo — confirma a
    correção documentada no código, agora para o caso que faltava, nenhum
    bug**: `createReturnFn` já tinha um comentário explicando um bug
    corrigido em sessão anterior — devolver o item de uma venda com
    dinheiro + crediário podia perdoar a parcela de crediário E devolver o
    valor cheio em espécie, entregando o dobro do que foi devolvido. Os
    testes ao vivo anteriores (itens 12/13) só tinham exercido essa
    correção numa devolução PARCIAL; a devolução TOTAL tem um branch
    próprio no código (cancela a comissão inteira em vez de ratear, define
    `sales.status = 'devolvida'` em vez de `'devolvida_parcial'`) que nunca
    tinha sido testado ao vivo.

    Venda de R$100 (R$60 dinheiro + R$40 crediário) devolvida por inteiro
    pela tela de Devoluções. Resultado no banco: `sales.status` →
    `devolvida`; `returns.kind` → `total`; o título de crediário foi para
    `cancelado` (dívida perdoada); e o estorno em dinheiro lançou **R$60,00
    exatos** — não os R$100 cheios, que teria duplicado o valor dos R$40 já
    perdoados via cancelamento do título. R$40 (perdão) + R$60 (espécie) =
    R$100, batendo exato com a venda original, sem sobra nem falta.
    Notificação e `audit_logs` corretos. Dados de teste (1 venda, 1
    devolução, 1 produto, 1 cliente, 1 caixa) revertidos depois.

    Nota de processo: a limpeza encontrou e removeu mais 2 notificações
    órfãs da empresa #4, de rodadas de devolução de sessões anteriores que
    aparentemente esqueceram a tabela `notifications` na limpeza — mesma
    classe de descuido já documentada no item 6 (tabela `expenses`
    esquecida). Sem impacto (notificação é só informativo, nada calcula em
    cima dela), e a tabela ficou vazia para a empresa #4 depois.

28. **Faixa de comissão por volume MENSAL testada ao vivo — confirmado
    correto, inclusive no limiar exato, nenhum bug**: dos três jeitos de
    regra de comissão (específica por categoria, bônus de meta, faixa por
    volume), só os dois primeiros tinham sido testados ao vivo (itens 16 e
    22). Faixa por volume (`tierBasis: "month"`, `pickTier`/`volumeFor` em
    `src/lib/commission.ts`) só tinha teste unitário.

    Regra de teste: 5% até R$200 de faturamento do vendedor no mês, 15% a
    partir daí. Duas vendas reais de R$100 pelo PDV, mesmo vendedor: a 1ª
    rendeu R$5,00 (volume do mês 0→100, faixa de 5%) e a 2ª rendeu R$15,00
    (volume 100→**200**, exatamente no limiar — a faixa de 15% começa em
    200, e bateu nela, não na de 5%). Esse é o caso mais fácil de errar por
    off-by-one (`>` vs `>=` no limite); confirmado correto nos dois sentidos
    pela própria tela, que já mostrou o aviso certo antes de finalizar
    ("esta venda leva a R$ 200,00 → faixa 15%") e confirmado no banco
    (`commissions.percent` 5.00 e 15.00). Dados de teste (1 vendedor, 1
    produto, 1 regra, 2 vendas, 1 caixa) revertidos por completo depois.

29. **Liquidação de cartão em LOTE testada ao vivo — confirma a correção do
    item 14 também no caso de várias parcelas de vendas diferentes, nenhum
    bug**: `settleCardBatchFn` (`src/lib/server/card-settlement.ts`) agrupa
    por data de liquidação e baixa tudo de uma vez; o item 14 já tinha
    provado que a baixa alimenta o fluxo de caixa certo, mas só com UMA
    parcela. Faltava provar o agrupamento de verdade — múltiplas parcelas,
    de vendas diferentes, na mesma data.

    Duas vendas reais de R$100 no crédito (sem taxa configurada, 1x,
    Visa), caindo as duas em 31/10/2026 por terem sido feitas no mesmo dia.
    A aba Cartões agrupou certo ("2 parcela(s) · Visa · R$ 200,00", um lote
    só). Ao confirmar: as duas `accounts_receivable` foram para `pago`,
    **cada uma com seu próprio `audit_logs` de ação `receive`** (não um
    registro só somado — é essa granularidade que o comentário do código já
    avisava ser necessária, ver item 14) mais um `audit_logs` de
    `settle-batch` resumindo o lote. O Fluxo de Caixa mostrou "Entradas
    R$200,00" no dia da liquidação, batendo exato com o lote. Dados de
    teste (2 vendas, 1 produto, 1 caixa) revertidos por completo depois.

30. **Troca de turno testada ao vivo — achado e corrigido um vazamento real
    que derrubava o propósito inteiro da contagem cega**: `openRegisterFn`/
    `closeRegisterFn` (`src/lib/server/finance.ts`) e a migration 0026
    implementam um desenho cuidadoso — quem fecha declara quanto deixa na
    gaveta, quem abre conta a gaveta recebida ANTES de ver o que foi
    declarado, e só depois o sistema revela a diferença (`checkHandover`).
    Nunca tinha sido testado ao vivo.

    Fechei um turno declarando R$40 na gaveta, depois abri o próximo
    contando errado de propósito (R$35): o sistema só revelou "Falta na
    troca R$5,00" DEPOIS da minha contagem, nunca antes — a aritmética e a
    sequência estão corretas. Mas achei o problema: a lista **"Fechamentos
    recentes"**, na MESMA tela `/app/caixa`, logo abaixo do formulário de
    contagem cega, já mostrava "Deixou R$40,00 na gaveta" sem nenhuma
    condição — `listCashClosuresFn` devolvia `handover_amount` sempre que
    não fosse nulo, sem checar se o turno seguinte já tinha "consumido" essa
    troca. Quem está prestes a contar a gaveta só precisa rolar a tela pra
    ver o número antes — exatamente o que a contagem cega existe pra
    impedir. Afeta todo papel que usa o caixa, inclusive o papel `pdv` (o
    mais restrito, que já tem `cash.read` + `cash.write`).

    **Corrigido** (autorizado pelo usuário): a query agora calcula
    `handover_consumed` (mesma condição de `loadPendingHandover` —
    `not exists` outro registro com `previous_register_id` apontando pra
    este), e `ficaNaGaveta`/`vaiProCofre` só saem preenchidos quando o
    troco já foi consumido (ou é zero, nada a esconder); enquanto pendente,
    a tela mostra só "Deixou troco na gaveta — valor some daqui até o
    próximo turno abrir e contar" (`cash-closures-panel.tsx`). O lado
    retrospectivo (`recebido`, "Recebeu contando X contra Y declarados") não
    muda — só aparece depois que quem recebeu já contou, então nunca foi um
    vazamento.

    **Provado ao vivo nos dois sentidos**: fechei dois turnos reais (R$40 e
    depois R$20 de troco); com o segundo pendente, a lista mostrou a frase
    neutra sem o valor; abri o turno seguinte contando certo (R$20,
    "Confere"), e só ENTÃO a lista passou a mostrar "Deixou R$20,00 na
    gaveta · R$15,00 pro cofre" — e o registro mais antigo (R$40, já
    consumido desde antes) continuou revelado o tempo todo, confirmando que
    a correção não escondeu informação que já deveria estar visível.
    `npm run typecheck`, `npm run lint` e `npm test` (423) limpos. Dados de
    teste (3 caixas, 1 venda, 1 produto) revertidos por completo depois.

31. **Limite de desconto do operador testado direto contra o servidor — a
    trava é real, não só da tela, nenhum bug**: `DiscountDialog` (PDV)
    desabilita o botão acima do limite do perfil, mas isso é só a tela — o
    que importa é se `checkoutFn` recusa de verdade quando alguém pula a
    tela e chama o servidor direto (mesmo princípio de `cashMoveFn`,
    `cancelSaleFn` etc. já confirmados nesta sessão). Nunca tinha sido
    testado ao vivo, só lido no código.

    Baixei temporariamente o limite do admin pra 5% (`memberships.
    discount_limit`, só nesta sessão de teste), confirmei que o `DiscountDialog`
    mostra "Limite do seu perfil: 5%." e bloqueia 20% na tela — e depois
    pulei a tela: chamei `checkoutFn` direto pelo console com 20% de
    desconto. Resultado: recusado com "Desconto acima do limite (5%).
    Solicite autorização." — a mesma mensagem do código, vinda do servidor,
    não da tela. Com exatamente 5% (o limite), a venda passou normal
    (`sales.discount` = 5.00). A trava é real nos dois sentidos — dentro do
    limite passa, acima é barrado — mesmo sem a tela no meio. Limite restaurado
    ao padrão (`null` → 100% do admin) e dados de teste (1 venda, 1 produto,
    1 caixa) revertidos por completo depois.

32. **CPF/CNPJ na nota testado ao vivo nos dois caminhos — nenhum bug**: no
    PDV, digitar um documento direto no campo "CPF ou CNPJ na nota" (sem
    escolher ninguém no "Ou busque no cadastro") deixa pro `checkoutFn`
    decidir: achar cliente existente com aquele documento e vincular, ou
    criar um "Consumidor" novo. Nunca tinha sido exercitado ao vivo — os
    testes anteriores sempre usaram o combobox de busca do cadastro.

    Caso 1: digitei um CPF válido sem nenhum cliente correspondente (deixando
    o combobox em "Consumidor (só o documento acima)") — `checkoutFn` criou
    um cliente novo "Consumidor" com aquele documento e vinculou a venda a
    ele. Caso 2: pré-cadastrei um cliente com outro CPF válido e, numa venda
    separada, digitei o MESMO CPF direto no campo (de novo sem tocar no
    combobox) — `checkoutFn` encontrou o cliente existente pelo documento e
    vinculou a venda a ele, sem duplicar. Confirmado no banco nos dois casos
    (`sales.customer_id` apontando pro cliente certo, `customers` sem
    duplicata). Dados de teste (2 vendas, 2 clientes, 1 produto, 1 caixa)
    revertidos por completo depois.

33. **Quantidade fracionada no PDV testada de ponta a ponta — nenhum bug**:
    `parseQuantity` (`src/lib/pdv-sale.ts`) aceita até 3 casas decimais
    (produto vendido por peso/metro, ex. "2,5"), mas isso nunca tinha
    passado por uma venda real — só teste unitário da função isolada.

    Editei a quantidade de um item pra "2,5" direto no campo do carrinho; a
    tela recalculou o total certo (R$25,00) antes mesmo de finalizar.
    Terminada a venda, bateu no banco: `sale_items.quantity` = 2.500,
    `stock_movements` com delta exato de -2.500, estoque foi de 10.000 para
    7.500 — sem arredondar pra 2 ou 3 unidades em nenhum ponto da cadeia
    (carrinho → checkout → baixa de estoque). Dados de teste (1 venda, 1
    produto, 1 caixa) revertidos por completo depois.

34. **Trocar de loja com venda em andamento vazava pra loja errada — achado
    grave, corrigido**: o seletor de loja no topo (`useSelection`, estado
    global) não tinha nenhuma trava contra mudar de loja com itens já no
    carrinho. `ProductSearch`/`add()` gravam preço e estoque da loja UMA VEZ,
    no momento de adicionar — trocar a loja depois não atualiza nada no
    carrinho, e `Finalizar venda` manda `storeId: activeStore`, ou seja, a
    loja ATUAL no seletor, não a loja em que o item foi escolhido.

    Reproduzido ao vivo, pior caso possível: escolhi um produto com a Loja
    Centro selecionada (estoque 5 lá), troquei pra Loja Shopping sem tocar
    no carrinho, finalizei. Resultado real no banco: a venda e a baixa de
    estoque saíram **inteiras na Loja Shopping** — a Loja Centro, onde o
    operador viu e escolheu o produto, nunca foi tocada. Nenhum aviso,
    nenhum erro: pareceu uma venda normal. Só não deu pra reproduzir ainda
    pior (loja sem aquele produto) porque falta de estoque acusa erro — mas
    com estoque suficiente nos dois lados (o caso comum, mesmo produto
    cadastrado nas duas lojas), o engano passa batido, lançando a venda e
    baixando o estoque físico da loja ERRADA de forma silenciosa.

    **Corrigido** (autorizado pelo usuário): novo `useEffect` em
    `src/routes/app/pdv.tsx` guarda a última loja vista (`lojaRef`); quando
    `activeStore` muda de verdade (não a carga inicial) com o carrinho
    não-vazio, cancela a venda (`novaVenda()`) e avisa — "Loja trocada: a
    venda em andamento foi cancelada — preço e estoque são por loja." Com
    carrinho vazio, trocar de loja continua livre, sem aviso nenhum
    (comportamento normal).

    **Provado ao vivo depois do fix**: mesmo roteiro (adicionar com Centro,
    trocar pra Shopping) — o carrinho esvaziou sozinho com o aviso exato, e
    confirmado que nenhuma venda nova foi criada e o estoque das duas lojas
    ficou intacto. `npm run typecheck`, `npm run lint` e `npm test` (423)
    limpos. Dados de teste (1 venda incorreta da reprodução, 2 produtos, 2
    caixas) revertidos por completo depois.

35. **Campo Observação do PDV testado — salva certo, nenhum bug**: nunca
    tinha sido confirmado se o texto digitado em "Observação" realmente
    persiste. Digitei um texto, finalizei a venda, conferido no banco:
    `sales.notes` saiu exatamente como digitado, sem sanitização estranha.
    Fecha a rodada de testes desta sessão no PDV (4 confirmações sem bug —
    limite de desconto, CPF na nota, quantidade fracionada, Observação — e
    1 bug real achado e corrigido — troca de loja com venda em andamento,
    item 34). Dados de teste (1 venda, 1 produto, 1 caixa) revertidos por
    completo depois.

36. **"Revelar o dinheiro esperado" no fechamento de caixa testado ao vivo
    — a via de escape da conferência cega é real e totalmente auditada,
    nenhum bug**: fica só com admin/gerente (`cash.reveal`, separada de
    `cash.read`/`cash.write` de propósito — ver comentário em
    `permissions.ts`), e existe pra quando a conferência cega não é
    possível ou necessária. Nunca tinha sido exercitada ao vivo — só os
    fechamentos cegos (itens 11 e 30).

    Cliquei "Revelar o dinheiro esperado" antes de contar: mostrou
    "Dinheiro esperado na gaveta R$80,00" e o aviso "a conferência deste
    turno deixou de ser cega". Fechei contando certo. Confirmado no banco:
    `expected_revealed_at`/`expected_revealed_by` gravados, um
    `audit_logs` próprio de ação `reveal-expected` (quem e quando), e o
    `audit_logs` do fechamento final com `cego: false` — a lista de
    fechamentos mostrou "Esperado revelado antes" em vez de "Conferência
    cega". Nada escondido, nada confundido com uma conferência cega de
    verdade. Dados de teste (1 venda, 1 produto, 1 caixa) revertidos por
    completo depois.

37. **Divergência de caixa acima da tolerância, exigindo explicação escrita,
    testada ao vivo — nenhum bug**: `CASH_DIFFERENCE_TOLERANCE` = R$2;
    acima disso o fechamento fica "pendente" até alguém escrever o que
    aconteceu (`explainCashDifferenceFn`). Nunca tinha sido exercitado ao
    vivo — só os fechamentos "bateu certo" (itens 11, 30, 36).

    Fechei contando R$90 contra R$100 esperado (falta de R$10, bem acima
    da tolerância): a tela acusou "Falta R$10,00" e "Acima de R$2,00 a
    diferença precisa de explicação escrita." Escrevi uma explicação na
    lista "Fechamentos recentes" — salvou (`difference_reason`,
    `difference_explained_at`, `difference_explained_by`), o aviso de
    pendência sumiu e a explicação passou a aparecer no card. Testei
    também a trava de "só uma vez": chamar `explainCashDifferenceFn` de
    novo pro mesmo fechamento foi recusado direto no servidor com "Esta
    diferença já foi explicada." Dados de teste (1 venda, 1 produto, 1
    caixa) revertidos por completo depois.

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
