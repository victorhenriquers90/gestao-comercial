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

38. **Auditoria de prontidão pra produção DE VERDADE, a pedido do usuário**
    — depois de 37 itens de correção/validação técnica, verifiquei o que
    falta no CADASTRO da empresa real, já que o código em si está bem
    testado. Achados no banco desta máquina piloto:

    - **`companies.document` (CNPJ/CPF) está `null`.** Sem isso não dá pra
      configurar NFC-e (Focus NFe exige), nem fechar boa parte da papelada
      contábil real. `address`/`city`/`state`/`zip`/`phone`/`ie` também
      estão todos `null` — é o registro que o seed criou, nunca editado.
    - **NFC-e desligada e sem credencial**: `company_settings.nfce_enabled
      = false`, e `FOCUS_NFE_TOKEN` não está nem configurado na variável de
      ambiente de Máquina. Hoje, TODA venda sai sem nota fiscal eletrônica
      — o código já suporta emitir (homologação por padrão,
      `FOCUS_NFE_ENV=producao` pra valer), só falta a conta no Focus NFe e
      o cadastro fiscal da empresa pra ligar.
    - **As duas lojas ainda se chamam "Loja Centro"/"Loja Shopping"** —
      nomes de demonstração do seed (item 4 já tinha avisado "renomeie se
      quiser"), nunca renomeadas. Se só existe UMA loja de verdade, a
      segunda loja fantasma é um risco real: estoque/venda pode ir pro
      lugar errado sem ninguém perceber (mesma classe do bug do item 34).
    - **Só existe 1 usuário (o admin)**: nenhum convite enviado ainda. Para
      operar com mais de uma pessoa no caixa, falta convidar a equipe com
      os papéis certos (vendedor/caixa/pdv) — o sistema de convite por
      token já está auditado e correto (item 15), só não foi usado ainda.
    - **Backup confirmado saudável**: `last-backup.json` mostra backup de
      30/09 às 22:30, a tarefa agendada segue rodando. Cópia fora da
      máquina continua pendente (item 15/pendência aberta).

    Nenhum código mudado aqui — são decisões e cadastros que só o usuário
    pode preencher (dados reais da empresa, conta no provedor fiscal,
    convites da equipe). Ver a mensagem de resposta desta rodada pro
    detalhamento priorizado.

O `--spacing-block` já rodou em todas as telas que qualificam, o `pdv.tsx`
inclusive — a conversão lá foi verificada instância por instância (12/12 em
12px, incluindo os diálogos de F4/F6/F8) e com uma venda de ponta a ponta.

39. **PDV touch pra tablet (`/app/pdv-tablet`) + extração do hook
    `usePdvSale`, e um alerta de infraestrutura achado no caminho**:

    - Toda a lógica de venda do PDV (estado, queries, `checkoutFn`,
      idempotência, guard de troca de loja, guard de duplo-clique) saiu de
      `pdv.tsx` pro hook `src/components/pdv/use-pdv-sale.ts`. `pdv.tsx` só
      monta a JSX a partir dele agora — atalho de teclado e navegação do
      carrinho com busca vazia ficaram no componente, fora do hook, por
      serem específicos de desktop. Comportamento idêntico, verificado ao
      vivo (ver abaixo).
    - Rota nova `src/routes/app/pdv-tablet.tsx`, pro balcão usar o PDV num
      tablet em paisagem pelo navegador (mesma rede local/Tailscale, sem
      instalar nada). Path começa com `/app/pdv` de propósito —
      `app-shell.tsx:53` trata qualquer rota com esse prefixo como tela de
      PDV (sidebar escondida, tela cheia) sem precisar tocar nesse arquivo.
      Reusa a mesma lógica via `usePdvSale()`; só `CartTable`/`SalePanel`
      ganharam versão touch (`TouchCartTable`/`TouchSalePanel`,
      `src/components/pdv-tablet/`) com os dois alvos de toque mais
      apertados do desktop corrigidos (stepper de qtd e remover item
      32px→56px, remover desconto 20px→44px). CSS novo isolado em
      `src/styles/pdv-tablet.css` (`pdvt-*`), zero mudança em `.pdv-*`.
    - **ALERTA DE INFRAESTRUTURA achado durante a verificação**: ao
      investigar por que o catálogo aparecia vazio no servidor de dev
      iniciado nesta rodada, descobri que `DATABASE_URL` está definida como
      variável de ambiente de **Máquina** (`[Environment]::GetEnvironmentVariable`
      com escopo `Machine`), não em `.env` nem via NSSM — ela não aparece
      em `HKLM...\GestaoComercial\Parameters` nem em nenhum arquivo do
      diretório instalado. Ou seja: **qualquer `npm run dev` rodado nesta
      máquina conecta no MESMO Postgres real da loja piloto**
      (`localhost:5432/gestao_comercial`) que o serviço instalado (porta
      8080) usa — não existe isolamento de ambiente de teste nesta máquina.
      Isto bate com a premissa de todo o `HANDOFF.md` ("verificar contra o
      Postgres real"), mas é fácil esquecer no meio de uma sessão longa e
      assumir por engano que um servidor de dev novo está isolado (foi
      exatamente o engano desta rodada — corrigido a tempo, ver abaixo).
      **Próxima IA: todo teste ao vivo com `npm run dev` nesta máquina
      grava no banco de produção de verdade. Dado descartável de teste
      exige limpeza explícita depois, sempre.**
    - Nesta rodada, antes de perceber isto, um produto de teste ("TESTE
      REFACTOR PDV"), 2 vendas (nº 1 e nº 2, as primeiras do tenant
      "Victor Comércio"/company 4) e 1 caixa aberto na Loja Shopping foram
      gravados no banco real. Limpos depois, numa transação só, cobrindo
      `payments`, `cash_movements`, `sale_items`, `stock_movements`,
      `sales`, `stock_counts` (cascata pra `stock_count_items`),
      `inventories`, `product_variants`, `products`, `cash_registers` e as
      linhas de `audit_logs` criadas por eles — verificado por contagem
      zerada em todas as tabelas pro `company_id = 4` depois, e confirmado
      de novo pela própria tela (caixa voltou a "Caixa fechado").
    - Verificação completa: `npm run typecheck` + `npm run lint` + `npm
      test` (423 testes) limpos; fluxo completo ao vivo em `/app/pdv`
      (desktop, confirma que a extração do hook não mudou nada) e em
      `/app/pdv-tablet` (viewport 1024×768, confirma o layout touch e o
      stepper de quantidade), produto → desconto → pagamento → finalizar →
      baixa de estoque, nos dois. Ressalva: cliques simulados no browser
      pane são mouse, não confirmam touch/multi-touch real num tablet
      físico.

40. **UI pra editar/renomear loja existente — gap achado no item 38**:
    `saveStoreFn` já suportava atualizar por `id` (nome, código, telefone,
    endereço, cidade, UF, CEP) desde sempre, mas a aba Lojas em
    Configurações só tinha "Adicionar loja" — lojas existentes eram
    só-leitura, sem nenhum jeito de corrigir o nome de demonstração sem
    mexer direto no banco. Cada loja ganhou um botão "Editar" com
    formulário inline. Verificado ao vivo contra o Postgres real: renomeei
    "Loja Centro" pra um nome de teste, confirmei no banco e na tela
    (lista e seletor do topo), e restaurei o nome original — round-trip
    completo, loja de volta ao estado exato de antes. `npm run typecheck`
    + `npm run lint` + `npm test` (423) limpos.

41. **Convite de equipe — criar/renovar/cancelar testados ao vivo, aceitar
    ficou pendente**: item 15 só tinha auditado `inviteMemberFn`/
    `acceptInvite` por leitura de código, nunca exercitado ao vivo. Pela
    tela de Configurações → Usuários, contra a empresa real:
    - **Criar** (`inviteMemberFn`): link gerado, convite aparece em
      "Convites pendentes" com papel e validade corretos.
    - **Renovar** (`renewInviteFn`): o token antigo parou de resolver
      (confirmado por hash no banco — zero linhas), o novo token resolve
      pro mesmo convite (mesmo `id`, mesma `role`). Correto.
    - **Cancelar** (`revokeInviteFn`): a linha some de verdade do
      `pending_invites` (`delete`, não soft-delete) — confirmado no banco
      e a seção "Convites pendentes" desaparece da tela (lista vazia).
    - **Aceitar** (`acceptInvite`) ficou **sem teste ao vivo**: simular a
      transação direto no banco (inserir um usuário descartável em
      `"user"` e rodar a mesma lógica) foi bloqueado duas vezes pelo
      classificador de segurança do Auto Mode (escrita na tabela de
      autenticação conta como "recurso compartilhado"); testar pela tela
      de cadastro de verdade exigiria deslogar da conta admin desta sessão
      sem como logar de volta (não guardo nem peço a senha do usuário).
      Perguntado, o usuário optou por **deixar como está** — a lógica
      já auditada no item 15 (papel vem só do convite gravado pelo admin,
      nunca de entrada do cliente; `acceptInvite` trava a linha do convite
      com `for update`; checa conta já vinculada a outra empresa) continua
      de pé, só sem a prova ao vivo da última ponta.
    - Nenhum código mudado — só verificação. Nenhum dado de teste ficou
      para trás (convites A e B ambos removidos; A por "Cancelar" na
      própria tela).

42. **DRE não reconciliava com devolução parcial no período — achado e
    corrigido** (`src/lib/server/reports.ts`): lendo `reportFn` atrás de
    bugs em fluxos nunca testados ao vivo (Relatórios inteiro estava nessa
    categoria), reparei que o relatório "DRE" soma `s.subtotal` cru, sem
    descontar devolução — mas "Receita líquida" (`s.total -
    ret.returned_revenue`) já desconta. As três primeiras linhas da
    própria tabela (Receita de vendas − Descontos = Receita líquida)
    paravam de bater sempre que havia devolução parcial no período.

    Reproduzido ao vivo: produto a R$100, venda de 2 unidades (R$200, sem
    desconto), devolução parcial de 1 unidade (R$100). Antes do fix:
    Receita de vendas R$200 − Descontos R$0 = R$200, mas Receita líquida
    mostrava R$100 — R$100 de diferença, exatamente o valor devolvido.
    Fix: `subtotal` passa a descontar `ret.returned_revenue` igual
    `revenue`/`cost` já faziam. Depois: R$100 − R$0 = R$100, bate.
    Verificado de novo ao vivo pela tela de Relatórios. Dado de teste
    (produto, venda, devolução, contagem de estoque, caixa) revertido por
    completo depois, numa transação só.

    Achado na mesma leitura, mesmo arquivo: o relatório "Por vendedor"
    somava a comissão do vendedor nas DUAS lojas mesmo com filtro de loja
    aplicado — Faturamento/Ticket respeitavam o filtro, a coluna Comissão
    não (a subquery não tinha como saber a loja da venda sem juntar com
    `sales`). Corrigido com `left join` por `sale_id` e o mesmo filtro
    `store_id` do resto da linha. Verificação mais leve aqui (sem vendedor
    cadastrado na massa de teste pra provar o double-counting entre duas
    lojas de verdade) — confirmado que a query roda sem erro e mantém o
    resultado correto no caso comum ("Sem vendedor").

    `npm run typecheck` + `npm run lint` + `npm test` (423) limpos.

43. **Cards de comissão do Dashboard ignoravam o filtro de loja — mesma
    classe do item 42, achada ao vivo desta vez** (`src/lib/server/
    insight.ts`): "Comissões a pagar" e "Comissões pagas no mês" somavam
    o vendedor nas DUAS lojas mesmo com uma loja específica selecionada
    no topo — Faturamento/Ticket/Lucro/A receber/A pagar já respeitavam
    o filtro (o próprio arquivo já documentava essa correção num
    comentário), só os dois cards de comissão ficaram de fora porque
    `commissions` não tem `store_id` próprio.

    Desta vez provado ao vivo de verdade, com double-counting
    reproduzido: vendedor de teste com uma venda de R$100 (comissão
    R$5) em CADA loja (Centro e Shopping). Antes do fix, qualquer das
    duas lojas filtrada mostraria R$10,00 (a soma das duas). Depois do
    fix: Loja Centro mostra R$5,00, Loja Shopping mostra R$5,00, cada
    uma só a sua. Corrigido com `left join` em `sales` pelo `sale_id` e
    o mesmo filtro de loja do resto do painel — igual ao fix do
    relatório "Por vendedor".

    De passagem, varri Fornecedores e CRM (nunca testados ao vivo) sem
    achar bug novo: cadastro de fornecedor, ficha 360 (Dados/Pedidos/
    Mix/Financeiro), quadro do CRM (mover estágio pelo select, criar e
    concluir tarefa de follow-up, nota) — tudo funcionando certo.

    Dado de teste (produto, vendedor, 2 vendas, 2 caixas, fornecedor,
    cliente, tarefa) revertido por completo depois, numa transação só.
    `npm run typecheck` + `npm run lint` + `npm test` (423) limpos.

44. **Pagar comissão em dinheiro não gerava sangria no caixa — achado
    auditando Promoções/Metas/Caixa a pedido do usuário** (`src/lib/
    server/finance.ts`): `settleSellerBatch` (usado por `payCommissionFn`
    e `payPendingCommissionsFn`, nunca exercitados ao vivo antes) emite
    um recibo pedindo assinatura do vendedor ("Recebi o líquido acima")
    — paga em dinheiro, na hora, do caixa aberto da loja. Mas só gravava
    `expenses` (`account_kind: 'caixa'`, coluna nunca lida de volta em
    lugar nenhum do código — confirmado por busca no projeto inteiro),
    nunca `cash_movements`. O `expectedCash` do fechamento
    (`loadOpenRegister`) só soma `cash_movements` — o dinheiro que saiu
    de verdade da gaveta nunca entrava na conta.

    Reproduzido ao vivo contra o Postgres real: caixa com fundo R$500 +
    venda de R$100 (esperado R$600), comissão de R$5 paga em espécie —
    `cash_movements` do registro continuou com UMA linha só (a venda).
    Fechar o caixa aquele dia cobraria R$600 de uma gaveta com R$595 de
    verdade: uma falta fantasma toda vez que se paga comissão em
    dinheiro, mesma classe dos bugs de quebra de caixa já corrigidos
    nesta sessão (itens 30/36/37).

    Fix: mesma lógica do `cashMoveFn` (sangria manual) — se houver caixa
    aberto na loja informada, lança sangria pelo mesmo valor de cada
    despesa gerada (líquido pro vendedor, e o imposto retido separado,
    que também sai fisicamente da gaveta, só muda de bolso dentro da
    loja). Sem caixa aberto (comissão paga fora do expediente, ou loja
    não informada), não há o que ajustar.

    Verificado ao vivo com contraste direto: pagamento feito ANTES do
    fix ficou sem sangria (confirmado por SQL); uma segunda venda +
    pagamento DEPOIS do fix no mesmo teste gerou a linha de sangria
    esperada (R$5,00, tipo sangria, método dinheiro, descrição
    referenciando a venda). Dado de teste revertido por completo.

    De passagem, testadas também **Metas** (meta de R$50 na Loja
    Shopping, venda de R$100 → "Meta batida", 200,0% — correto) e
    **Promoções** (desconto percentual simples de 10%, nunca testado ao
    vivo nesta sessão — R$100 → R$90,00 no PDV, correto). Nenhum bug
    novo nessas duas.

    `npm run typecheck` + `npm run lint` + `npm test` (423) limpos.

45. **Pagar fornecedor em dinheiro também não gerava sangria — mesma
    classe do item 44, achada em seguida** (`src/lib/server/finance.ts`
    + `src/routes/app/financeiro.tsx`): `settlePayableFn` ("Contas a
    pagar") baixava o título sem nunca perguntar como foi pago nem
    lançar nada em `cash_movements` — comum o entregador cobrar na hora
    em dinheiro. `settleReceivableFn` já tratava isso do lado do
    recebimento (comentário no próprio arquivo já descrevia esse exato
    bug, corrigido ali antes). Fix simétrico: exige `method` e, em
    dinheiro, lança sangria no caixa aberto da loja; UI trocou o botão
    único "Pagar" por duas etapas (escolher forma → Confirmar), igual
    ao padrão já usado em "Contas a receber" na mesma tela.

    Verificado ao vivo: conta de R$30 paga em dinheiro com caixa
    aberto → `cash_movements` ganhou a sangria (R$30, "Pagamento:
    ..."), título foi pra 'pago'. Dado de teste revertido.
    `npm run typecheck` + `npm run lint` + `npm test` (423) limpos.

46. **Autocrítica: os fixes dos itens 44/45 duplicavam o valor no "Fluxo
    de caixa" — achado revisando o próprio trabalho antes de seguir**
    (`src/lib/server/finance.ts`, `src/lib/constants.ts`): as duas
    sangrias que acabei de lançar (comissão e fornecedor pagos em
    dinheiro) somavam corretamente no `expectedCash` do fechamento, mas
    `cashflowFn` (aba "Fluxo de caixa") já conta esse mesmo valor via
    `paid`/`expenses` — somar `sangria` por cima duplicava a saída
    (pagar R$20 em dinheiro inflava "Saídas" pra R$40).

    Fix: as duas gravações passam a usar um tipo novo,
    `sangria_liquidacao` (sem migration — `cash_movements.type` é texto
    livre, sem CHECK). O fechamento de caixa soma os dois tipos
    (`sangria` + `sangria_liquidacao`); `cashflowFn` continua somando só
    `sangria` pura, excluindo o novo tipo por construção em vez de
    tentar deduzir "este sangria já tem expense" pela descrição. Rótulo
    "Pagamento" adicionado em `CASH_MOVE_LABELS` pro extrato do turno
    (Caixa) mostrar certo.

    Verificado ao vivo: conta de R$20 paga em dinheiro — `cash_movements`
    gravou `sangria_liquidacao` (não mais `sangria`), "Saídas" no Fluxo
    de caixa mostrou R$20,00 exatos (não R$40,00), e o agrupamento por
    método/tipo que alimenta o fechamento confirma que o novo tipo entra
    no cálculo do esperado. Dado de teste revertido.

    Lição de processo: ao corrigir um bug de "dinheiro não lançado em
    cash_movements", sempre conferir TODO lugar que já soma
    `cash_movements` pra outro fim (aqui, `cashflowFn`) antes de dar o
    fix por encerrado — o mesmo lançamento que resolve o fechamento pode
    quebrar outro relatório que lia a ausência dele como normal.

    `npm run typecheck` + `npm run lint` + `npm test` (423) limpos.

47. **Despesa manual em dinheiro (aba "Despesas" do Financeiro) tinha o
    mesmo bug dos itens 44/45, num terceiro lugar** (`src/lib/server/finance.ts`
    + `src/routes/app/financeiro.tsx`): `saveExpenseFn` nem perguntava como a
    despesa foi paga — motoboy, material de limpeza, qualquer coisa paga da
    gaveta nunca virava `cash_movements`. Mesma falta fantasma no fechamento.

    Fix: campo "Como pagou?" (`RECEIPT_METHODS`) no formulário de Nova
    despesa, pré-selecionado em "Dinheiro" por ser o caso mais comum pra
    despesa pequena de balcão. Em dinheiro, exige loja selecionada e caixa
    aberto (mesmas mensagens de erro de `settlePayableFn`) e grava
    `sangria_liquidacao` — não `sangria` pura, pelo mesmo motivo do item 46
    (`cashflowFn` já soma esta despesa via `expenses`).

    Verificado ao vivo: despesa de R$15 em dinheiro na Loja Shopping (fundo
    R$350) — `cash_movements` gravou `sangria_liquidacao`/dinheiro/R$15,
    "Dinheiro esperado na gaveta" caiu pra R$335,00, extrato do turno
    mostrou "Pagamento · Despesa: ..." (rótulo reaproveitado do item 46), e
    "Fluxo de caixa" mostrou Saídas = R$15,00 (não R$30,00 — sem duplicar).
    Dado de teste revertido por completo (expense, cash_movement,
    cash_register e audit_logs da abertura/revelação).

    Com isto, as três formas de dinheiro sair da gaveta por um caminho que
    não é "Sangria" manual — comissão (44), fornecedor (45), despesa (47) —
    agora alimentam o fechamento de caixa corretamente, sem duplicar o
    Fluxo de caixa (46).

    `npm run typecheck` + `npm run lint` + `npm test` (423) limpos.

48. **Relatórios "Comissões" e "Retenções" também ignoravam o filtro de
    loja — terceiro e quarto lugar da mesma classe dos itens 42/43**
    (`src/lib/server/reports.ts` + `src/lib/server/retention.ts`):
    `reportFn` tipo "comissao" montava os parâmetros da query à mão, sem
    `storeId`; `loadRetentionGuide` (usada pelo tipo "retencoes") nem
    tinha o parâmetro. Nenhum dos dois fazia join com `sales` pra filtrar
    por `store_id` — trocar de loja no seletor do topo não mudava nada,
    os dois sempre somavam as duas lojas juntas. Mais grave que os
    anteriores: "Retenções" é a guia usada pra fechar folha com o
    contador.

    Fix: `loadRetentionGuide` ganhou `storeId` opcional (5º parâmetro,
    depois de `sellerId`) — só `reports.ts` passa; `retentionGuideFn`
    (guia de `vendedores.tsx`) continua sem passar, de propósito, porque
    fecha folha da empresa inteira, não por loja (tem seletor de loja na
    página, mas é pra saber de QUAL caixa sai o dinheiro ao pagar, não
    pra filtrar a lista — mesmo uso de `storeId` do item 44).

    Verificado ao vivo: vendedor e produto descartáveis, uma venda de
    R$100 em cada loja (comissão de R$5 cada, ambas pagas em dinheiro).
    Com Loja Centro selecionada, "Comissões" e "Retenções" mostraram
    R$5,00 (não R$10,00); trocando pra Loja Shopping, R$5,00 da outra
    venda. A guia de Vendedores > Retenções (não filtrada por loja, por
    design) continuou somando R$10,00 corretamente — confirma que o
    parâmetro opcional não vazou pro caminho que não deveria mudar.
    Dado de teste revertido por completo.

    `npm run typecheck` + `npm run lint` + `npm test` (423) limpos.

49. **Exportação CSV de Relatórios vulnerável a injeção de fórmula —
    achado por revisão de código, não por teste de fluxo** (`src/routes/app/relatorios.tsx`,
    `csvCell`): qualquer texto livre que aparece num relatório (descrição
    de despesa/conta, nome de cliente/fornecedor) ia direto pra célula do
    CSV exportado. Um valor começando com `=`, `+`, `-` ou `@` — digitado
    por qualquer usuário, sem precisar de falha nenhuma no sistema — vira
    fórmula ao abrir no Excel/LibreOffice. Um `=HYPERLINK(...)` nessa
    célula pode vazar dado pra fora assim que o contador abre o arquivo
    exportado.

    Fix padrão OWASP: prefixo `'` em células de texto/data que começam
    com esses caracteres, neutraliza a fórmula sem mudar o que aparece na
    célula. Colunas numéricas (money/qty/pct) nunca passam por esse
    caminho — um valor negativo legítimo continua normal.

    Verificado ao vivo: conta a pagar com descrição `=1+1 TESTE
    AUDITORIA CSV` — a tela mostra o texto normal (React escapa JSX por
    padrão, sem risco), mas o CSV exportado (capturado via hook em
    `URL.createObjectURL`, sem precisar baixar o arquivo de verdade)
    gravou `'=1+1 TESTE AUDITORIA CSV`. Único ponto de exportação CSV do
    projeto inteiro (`grep` confirmou); "Imprimir / PDF" usa
    `window.print()` sobre o DOM já renderizado pelo React, sem risco
    equivalente. Dado de teste revertido.

    `npm run typecheck` + `npm run lint` + `npm test` (423) limpos.

50. **Cadastro de produto nunca teve campo "Fornecedor" — achado revisando
    o resto de `catalog.ts` depois do item 49** (`src/routes/app/produtos.tsx`):
    `saveProductFn` aceita e grava `supplierId` desde sempre, com um
    `coalesce` defensivo (`if (data.supplierId === undefined) supplierId =
    cur?.supplier_id ?? null`) pra edição sem o campo não apagar o que já
    tinha — mas nenhuma tela jamais ENVIAVA esse valor. Grep no projeto
    inteiro confirmou: o único jeito de um produto ganhar `supplier_id` era
    direto no banco (`seed.ts`).

    Isso tornava a Sugestão de compra (item novo desta sessão, nunca
    testado ao vivo até agora) morta na prática: ela agrupa por
    fornecedor e manda "Defina o fornecedor no cadastro destes produtos
    para gerar o orçamento" — apontando pra um campo que não existia.
    Todo produto caía sempre em "Sem fornecedor definido".

    Fix: `<Select>` de Fornecedor no diálogo de Novo/Editar produto,
    ligado ao `supplierId` que o backend já suportava.

    Verificado ao vivo: fornecedor e produto descartáveis (mínimo 5,
    estoque 0) — o produto salvou com `supplier_id` correto, a Sugestão de
    compra agrupou sob o NOME do fornecedor (não mais "Sem fornecedor
    definido"), e "Gerar orçamento" criou o pedido de compra real
    (status `orcamento`) com fornecedor, quantidade (5) e custo (R$100,00)
    corretos. Dado de teste revertido por completo.

    `npm run typecheck` + `npm run lint` + `npm test` (423) limpos.

    De passagem, duas auditorias de segurança full-codebase (SQL injection
    em `sql.query()` e isolamento entre tenants/IDOR em todo `src/lib/server/*.ts`)
    não encontraram nenhum problema real — todo ponto de interpolação em
    SQL é enum fixo ou fragmento estático, e todo `id` vindo do cliente é
    validado contra `company_id` antes de uso (direto, via
    `assertOwned`/`assertStore`, ou reaproveitando uma linha já validada
    na mesma função). Confirma que a base já passou por um endurecimento
    sério antes desta sessão.

51. **Nenhuma tela criava CATEGORIA de produto — beco sem saída pra
    empresa nova, achado ao investigar o mesmo padrão do item 50**
    (`src/routes/app/produtos.tsx`): `saveCategoryFn` existia desde sempre
    em `catalog.ts`, mas nenhuma tela do projeto inteiro o chamava — só
    `listCategoriesFn` (leitura) era usado. Uma empresa nova (ou o piloto,
    depois da limpeza de dados de demonstração do item 4) tem ZERO
    categorias e nenhum jeito de criar a primeira pela UI: o Select de
    Categoria em Produtos ficaria travado em "—" pra sempre, e tudo que
    depende de categoria junto (regra de comissão por categoria, meta por
    categoria, relatório "Por categoria"). Mais severo que o equivalente
    de Fornecedor (item 50): categoria não tem nenhuma tela dedicada pra
    apontar como alternativa.

    Fix: campo "Nova categoria" + botão "Criar" logo abaixo do Select, no
    mesmo diálogo de Novo/Editar produto — cria via `saveCategoryFn`,
    invalida a lista e já seleciona a categoria nova.

    Verificado ao vivo: categoria criada pelo campo novo, auto-selecionada;
    produto salvo com `category_id` correto; listagem de Produtos mostrou
    o nome certo na coluna Categoria. Dado de teste revertido por completo.

    (`brand_id`/`listBrandsFn` têm o mesmo gap — backend pronto, zero UI —
    mas nenhuma feature hoje DEPENDE de marca estar preenchida, diferente
    de fornecedor/categoria. Não mexido por enquanto; mesmo padrão, se
    algum dia uma tela precisar.)

    `npm run typecheck` + `npm run lint` + `npm test` (423) limpos.

52. **Nome, CPF/CNPJ, endereço, UF e observações de cliente e fornecedor
    eram IMPOSSÍVEIS de corrigir depois de cadastrados** (`customer-panel.tsx`,
    `supplier-panel.tsx`): a aba "Dados" só editava telefone, e-mail,
    cidade e limite (cliente) / telefone, e-mail, representante, cidade e
    observações (fornecedor). Os campos "críticos" eram reenviados do
    cadastro original (`name: c.name`, `document: c.document`...) — então
    um CPF/CNPJ digitado errado, ou um nome com erro de digitação, ficava
    pra sempre: não existe tela de exclusão (`grep` por `delete from
    customers|suppliers` não acha nada) nem de edição desses campos. Num
    ERP real isso trava o cadastro de qualquer cliente que alguém digitou
    com pressa; e pra fornecedor trava o CNPJ usado em compras/NF.

    Fix: a aba "Dados" dos dois painéis agora edita também Nome / Razão
    social, CPF ou CNPJ (com a máscara de `lib/document.ts`, conforme o
    `kind` do cliente), UF e Endereço — e Nome fantasia no fornecedor —
    mais Observações no cliente (o fornecedor já tinha). A validação de
    CPF/CNPJ e a trava de duplicidade (`assertFreeDocument`, que ignora o
    próprio `id`) já estavam no backend e passam a valer na edição.

    Verificado ao vivo contra o Postgres real: cliente criado com nome
    errado e CPF 111.444.777-35 → painel corrigiu nome, CPF (gravado só
    com dígitos), UF (digitada "sp", gravada "SP"), endereço e observações,
    `crm_stage` intacto; CPF inválido (11111111111) recusado com "CPF
    inválido." e banco inalterado. Fornecedor idem: razão social, nome
    fantasia, CNPJ, UF e endereço gravados corretamente. Dados de teste
    (cliente 45, fornecedor 13 e a linha de `audit_logs` do cadastro)
    removidos numa transação; contagem final zero.

    Colunas `customers.ie`, `rg`, `birth_date` e `zip` continuam sem NENHUM
    campo na UI (nem no cadastro, nem no painel), e `getCustomerFn` nem as
    devolve — hoje nada as preenche, então o `update` que as zera não perde
    dado. Se algum dia uma tela ou importação passar a gravá-las, o painel
    precisa devolvê-las no payload (como o painel de fornecedor já faz com
    `zip`/`whatsapp`), senão cada "Salvar dados" as apaga.

    Também neste item: `eslint .` varria os binários de build do instalador
    (`installer-gui/**/bin|obj|publish`, ~10 mil falsos erros) — agora
    ignorados em `eslint.config.mjs` — e 4 erros reais em `src` foram
    zerados (`tax.ts` let→const; `sanitize.ts`/`check-digit.ts`
    `no-control-regex` marcados como intencionais; `catch {}` vazio em
    `app-data/client.server.ts` ganhou comentário). Lint: 0 erros, 7
    avisos antigos.

    `npm run typecheck` + `npm run lint` + `npm test` (423) limpos.

53. **Não havia como desligar um funcionário nem um vendedor que saiu da
    empresa** (`configuracoes.tsx` aba Usuários, `vendedores.tsx`). O
    backend já tinha `isActive` nos dois (`updateMemberFn` com as travas
    "não desativar a si mesmo" e "manter ao menos um administrador";
    `saveSellerFn`, e `listActiveSellerNamesFn` filtrando `is_active`), mas
    NENHUMA tela o enviava: a aba Usuários só tinha o seletor de papel e o
    formulário de vendedor não tinha o campo. Na prática, quem saía da
    empresa mantinha login com o papel que tinha (`requireTenant` só barra
    `memberships.is_active = false`) e o vendedor continuava aparecendo no
    seletor do PDV, recebendo venda e comissão, para sempre.

    Junto, três defeitos de "campo não enviado vira padrão" no servidor:
    - `updateMemberFn` gravava `is_active = data.isActive ?? true` e
      `discount_limit` = padrão do papel sempre que o limite não vinha — ou
      seja, toda troca de papel reativava quem estivesse desativado e
      apagava um limite de desconto personalizado, mesmo sem o papel mudar.
    - A trava "mantenha ao menos um administrador" comparava `nextRole !==
      "admin"` com `nextRole` indefinido quando só se alternava o ativo:
      acusava erro à toa (e contava o admin já inativo como se valesse).
    - `saveSellerFn` (formulário de vendedor) não reenviava `storeId` nem
      `isActive`, então todo "Salvar" de um vendedor com loja (os do seed
      têm) zerava `store_id` e reativava quem estivesse inativo. No piloto
      real não havia vendedor algum, então nada foi perdido ainda.

    Fix: aba Usuários ganhou Desativar/Reativar por pessoa (escondido no
    próprio usuário e para quem não tem `users.write`), selo "Inativo" e
    seletor de papel travado nos inativos; `getSettingsFn` passou a listar
    inativos (só a aba Usuários consome `members`). `updateMemberFn` agora
    preserva `is_active` e o limite quando não vêm no pedido (o limite só
    vai ao padrão do novo papel quando o papel muda) e a trava de último
    admin olha o papel resultante e só conta quem está ativo; a auditoria
    guarda `isActive` antes/depois. O formulário de vendedor ganhou "Vendedor
    ativo" (só na edição), reenvia `storeId`/`isActive` e a lista mostra
    "Inativo".

    Verificado ao vivo contra o Postgres real, com membro (id 8, papel
    gerente, limite 7) e vendedor (id 25) descartáveis: Desativar →
    `is_active=false` com limite 7.00 preservado (o código antigo o levaria
    a 25); Reativar → volta, limite 7.00; trocar o papel para vendedor →
    limite 5.00 (padrão do novo papel) e `is_active` intacto; botão de
    desativar ausente na linha do admin logado. Vendedor com `store_id=7`
    editado pela tela (só o telefone) manteve a loja 7; desmarcar "ativo" →
    `is_active=false`, selo "Inativo" na lista e o seletor real do PDV
    ficou só com "Sem vendedor"; remarcar → volta a ativo. Dados de teste
    (membro, usuário, vendedor e 4 linhas de `audit_logs`) removidos numa
    transação; contagem final zero.

    NÃO verificado ao vivo: o caminho que RECUSA ("Mantenha ao menos um
    administrador"), porque exigiria rebaixar o único admin real do piloto.
    A lógica foi revisada por leitura: membro ativo e admin, papel
    resultante diferente de admin (ou desativação), e contagem de admins
    ativos ≤ 1 → erro. Se alguém for testar, faça num tenant descartável.

    `npm run typecheck` + `npm run lint` (0 erros, 7 avisos antigos) +
    `npm test` (423) limpos.

54. **`saveStoreFn` gravava o que chegava, sem validar nem auditar.** Único
    cadastro do sistema que ainda não passava pelo `sanitize`: o nome ia
    cru (espaços nas pontas, tags HTML, tamanho livre), "São Paulo" entrava
    como UF (as colunas são `text`, sem CHECK), duas lojas podiam ter o
    mesmo nome/código (indistinguíveis nos seletores e relatórios por
    loja), a edição achava lojas apagadas (`deleted_at`) e nada ia para
    `audit_logs` — ao contrário de empresa e usuário. Sintoma já visível no
    banco: a Loja Centro tem `""` em telefone/endereço/CEP e a Loja Shopping
    tem `null` (a UI mandava string vazia).

    Correção (`session.ts`): o validador usa `requireLine`/`optionalLine`/
    `sanitizeCode`/`parseUf` (mesmos da empresa); nome e código repetidos
    na mesma empresa (sem diferenciar maiúscula) são recusados; a edição só
    acha loja não apagada ("Loja não encontrada."); campo que não veio no
    pedido mantém o gravado (undefined ≠ null apagado de propósito — mesma
    família do item 52); criar e editar auditam (`entity = 'store'`, com
    antes/depois).

    Verificado ao vivo pela tela Configurações → Lojas, contra o Postgres
    real: "loja CENTRO" recusada ("Já existe uma loja com esse nome.", nada
    criado); `   ZZTESTE <b>Loja</b> Norte   ` gravou `ZZTESTE Loja Norte`;
    UF "São Paulo" recusada ("UF deve ter 2 letras (ex.: SP)."); código
    "lj01" recusado ("Já existe uma loja com esse código."); código ZZ99,
    UF "sp" e telefone com espaços gravaram `ZZ99` / `SP` / `(11) 99999-0000`,
    vazios como `null`; 2 linhas de auditoria com antes/depois. Loja e
    auditoria de teste removidas; contagem final zero e 2 lojas reais.
    `typecheck` + `lint` (0 erros) + `npm test` (423) limpos.

    NÃO existe como encerrar uma loja: não há função de servidor nem botão
    (`stores.is_active`/`deleted_at` existem e nada os grava). Não foi
    construído de propósito — exige decidir o que fazer com o estoque da
    loja, vendas/caixa abertos e `memberships.store_id` que apontam para
    ela (`defaultStoreId` usa esse id sem checar se a loja saiu da lista, e
    `assertStore` recusaria o PDV). Os campos endereço/telefone/CEP/UF da
    loja hoje só aparecem na própria aba Lojas; nenhum cupom ou nota os lê.

55. **A aba Auditoria era ilegível e a auditoria de produto não guardava
    preço nem custo.** A tela mostrava só `ação · entidade id` ("update ·
    product 93"), sem quem fez nem o que mudou, e `saveProductFn` gravava no
    `audit_logs` apenas o nome — a mudança que mais interessa ao dono
    (alguém baixou o preço? mexeu no custo?) não deixava rastro.

    Correção: `listAuditFn` (`session.ts`) faz `left join "user"` e devolve
    `user_name`, `before_data`, `after_data`; `saveProductFn` (`catalog.ts`)
    lê o produto antes de gravar e audita antes/depois de `name`, `price`,
    `cost`, `promoPrice` e `isActive`; o novo `src/lib/audit-label.ts`
    transforma a linha em texto ("Victor alterou produto “X”" + "preço: R$
    50,00 → R$ 40,00"), traduzindo papel, situação e limite de desconto, e
    mostrando só os campos que mudaram. 7 testes novos
    (`audit-label.test.ts`).

    Verificado ao vivo contra o Postgres real: produto descartável editado
    pela tela (preço 50 → 40) gravou `before_data.price = 50` /
    `after_data.price = 40`, e a aba Auditoria exibiu "Victor alterou produto
    “ZZTESTE Produto Auditoria” — preço: R$ 50,00 → R$ 40,00"; as linhas
    antigas (sem preço) continuam aparecendo só com título. Produto,
    variante e auditoria de teste removidos; contagem final zero.
    `typecheck` + `lint` (0 erros, 7 avisos antigos) + `npm test` (430)
    limpos.

    Lacunas de auditoria que continuam: atualização de cliente, fornecedores
    e vendedores (inclusive ativar/desativar do item 53) não auditam; a aba
    mostra só as 40 mais recentes, sem paginação na tela (`listAuditFn` já
    aceita `page`).

56. **Salvar cliente, fornecedor e vendedor não deixava rastro, aceitava
    valor impossível e apagava campo que a tela não enviou.** Achados em
    `party.ts`, todos reproduzidos antes de corrigir:

    - **Comissão do vendedor sem validação**: `saveSellerFn` aceitava 150% e
      -5% (a comissão vira dinheiro na folha). Agora `requireRange` (0–100).
    - **Reativação silenciosa**: `isActive ?? true` — um salvamento que não
      mandava `isActive` religava o vendedor desativado (item 53). Agora
      preserva o valor guardado.
    - **Cliente: salvar pelo painel apagava IE, RG, CEP, limite de crédito e
      vendedor** (o painel não envia esses campos, o servidor gravava o
      default). Mesma família do "campo não enviado vira default" dos itens
      anteriores: `undefined` = não mexe, `null`/`""` = limpou de propósito.
    - **UF truncada**: "São Paulo" virava "Sã" em cliente e fornecedor.
      `parseUf` (agora em `sanitize.ts`, reaproveitado por `session.ts`)
      recusa o que não tem 2 letras. `creditLimit` ganhou `requireRange`.
    - **Editar registro inexistente/apagado "dava certo"** (UPDATE em zero
      linhas). Agora lê a linha antes e lança "Cliente/Fornecedor/Vendedor
      não encontrado.".
    - **Sem auditoria**: edição de cliente, criação/edição de fornecedor e de
      vendedor não gravavam nada. Agora gravam antes/depois (nome, documento,
      contato, limite, comissão, regime, salário, ISS, loja, situação...).
      `auditUpdate` (`context.ts`) só grava se algo mudou — salvar sem alterar
      não gera linha "alterou X" vazia. `audit-label.ts` ganhou os campos e as
      entidades fornecedor/vendedor (documento formatado, comissão/ISS em %,
      regime por extenso, loja, situação).

    Verificado ao vivo contra o Postgres real com ZZTESTE (cliente 46,
    vendedor 26, fornecedor 14), chamando as server functions reais pela
    sessão logada: comissão 150/-5 e UF "M" recusadas; edição pelo painel
    preservou ie/rg/limite e `zip: ""` limpou o CEP; vendedor inativo
    continuou inativo; ids inexistentes recusados; `audit_logs` com
    before/after corretos; salvar fornecedor sem mudar nada não gravou linha
    e a mudança de cidade gravou (id 177); a aba Auditoria exibiu "Victor
    alterou vendedor “ZZTESTE Vendedor” — comissão: 8% → 12% · salário: R$
    2.000,00 → R$ 2.500,00 · loja: Loja Centro → Loja Shopping · situação:
    ativo → inativo" e linhas equivalentes para cliente e fornecedor. Dados
    de teste e 12 linhas de auditoria removidos; contagem final zero.
    `typecheck` + `lint` (0 erros, 7 avisos antigos) + `npm test` (434)
    limpos. Testes novos em `sanitize.test.ts` (`parseUf`, `requireRange`) e
    `audit-label.test.ts`.

    Lacunas que continuam: a aba Auditoria mostra só as 40 mais recentes
    (sem paginação na tela, `listAuditFn` já aceita `page`) — filtro por
    usuário/período chegou no item 71, paginação na tela continua em aberto;
    `birthDate` sem validação e `monthlySalary` sem teto foram fechados no
    item 72 (o `coalesce` do `birthDate` continua — nenhuma tela usa o campo
    pra testar se deveria dar pra limpar); o serviço instalado só recebe
    isto quando for atualizado.

57. **A aba Auditoria parava nas 40 mais recentes.** O dono não via nada
    além disso: a tela chamava `listAuditFn` sem página e não havia como
    pedir a seguinte. Com o item 56 gravando cliente, fornecedor e vendedor,
    as 40 linhas passam a durar poucos dias de uso.

    Correção: `listAuditFn` (`session.ts`) trocou `page`/offset por cursor
    (`before` = último id recebido). Offset repetiria ou pularia linhas se
    entrasse registro novo enquanto o dono navega; o cursor não. Busca 41
    para saber se há mais e devolve `{ rows, nextBefore }` (`nextBefore` nulo
    na última página, então o botão nunca leva a uma página vazia). A ordem
    passou a ser só por `id desc` — conferido no Postgres real que `id` e
    `created_at` andam juntos (0 linhas fora de ordem). `parseCursor`
    (`sanitize.ts`) transforma lixo (texto, negativo, 0, 1.5, NaN) em
    "primeira página" em vez de erro cru do banco. Na tela
    (`configuracoes.tsx`) a aba usa `useInfiniteQuery` com botão "Carregar
    mais", só consulta se o papel tem `audit.read` (antes disparava para
    qualquer papel) e passou a mostrar "Carregando...", erro e "Nenhuma
    alteração registrada ainda." — antes a lista vazia era um card em branco.

    Verificado ao vivo contra o Postgres real: fornecedor ZZTESTE editado 48
    vezes pelo próprio app (48 linhas de auditoria, 61 no total da empresa).
    Aba: 40 linhas + botão → clique → 61 linhas, botão some. Pela função, ids
    únicos e decrescentes, páginas [40, 21], total igual ao `count(*)` do
    banco; cursor -3/"abc"/0/1.5/null devolve a primeira página. Dados de
    teste removidos (48 linhas + fornecedor); empresa 4 voltou às 13 linhas
    de antes. `typecheck` + `lint` (0 erros, 7 avisos antigos) + `npm test`
    (436) limpos; 2 testes novos em `sanitize.test.ts`.

    Lacunas que continuam: a aba não filtra por tipo (produto, cliente...)
    nem por pessoa; outras telas de cadastro ainda não auditam (loja,
    cartões/taxas, metas, regras de comissão — conferir antes de afirmar).

58. **Lançamentos do financeiro aceitavam valor negativo, edição que
    quebrava a baixa e não deixavam rastro.** Cinco buracos em
    `finance.ts`, todos conferidos no código antes de mexer:

    - `saveExpenseFn` não validava nada: o formulário (`type=number` sem
      mínimo) deixa digitar -50 e o servidor aceitava. Em DINHEIRO isso
      gravava uma `sangria_liquidacao` NEGATIVA, que entra no
      `expectedCash` do fechamento como dinheiro entrando na gaveta — a
      diferença real do caixa sumia. Data também não era checada
      (`2026-02-31`, ano 3026).
    - `savePayableFn`/`saveReceivableFn` idem (valor, data, descrição
      vazia). A edição de conta a pagar só tinha `status in ('pendente',
      'parcial')`; a de conta a receber não tinha guarda NENHUMA: editava
      título já pago e parcela de crediário/cartão (`origin <> 'manual'`),
      desencontrando o título da venda e da conciliação da operadora.
    - As duas edições aceitavam valor MENOR que o já pago/recebido: a conta
      ficava "parcial" para sempre com saldo negativo e a baixa seguinte
      nunca fechava. E um `UPDATE` que não achava a linha respondia sucesso
      (id inexistente ou de outra empresa).
    - Nada disso — criar despesa, criar/editar conta, sangria, suprimento —
      ia para `audit_logs`. A baixa (`pay`/`receive`) já ia, mas sem
      descrição nem forma de pagamento.

    Correção: `requireMoney` (> 0, até 999.999.999, arredonda ao centavo) e
    `requireIsoDate` (dia que existe no calendário, 2000–2100) em
    `sanitize.ts`, usados no `validator` das quatro funções
    (`saveExpenseFn`, `savePayableFn`, `saveReceivableFn`, `cashMoveFn`); a
    descrição passa por `requireLine`. As edições rodam em
    `sql.transaction` com `select ... for update` e recusam: não
    encontrada, não está em aberto, origem diferente de manual (só a
    receber), valor abaixo do já pago/recebido. Auditam com `auditUpdate`
    (edição sem mudança não grava linha), criação com `audit`. `cashMoveFn`
    agora confere a loja (`assertStore`), grava movimento + auditoria na
    mesma transação, com ação `sangria`/`suprimento` e `{ amount, reason }`.
    As baixas passaram a registrar descrição e forma. Na tela, o campo
    Valor da despesa ganhou `min="0.01"`.

    `audit-label.ts` aprendeu a ler isso: entidade "despesa", ações "lançou
    sangria/suprimento no", campos descrição/valor/vencimento (dd/mm/aaaa)/
    categoria/fornecedor/cliente/loja, e — novo — eventos SEM "antes"
    (criação, baixa, sangria) mostram o que carregam: "valor: R$ 30,46 ·
    motivo: troco padeiro", "valor: R$ 60,00 · forma: PIX · situação:
    parcial". Antes só o título aparecia e o valor ficava invisível.

    Verificado ao vivo contra o Postgres real (empresa 4, loja 8) pelas
    server functions reais: valor -50/0/"abc", data 2026-02-31 e 3026-10-04,
    descrição em branco, loja de outra empresa e tipo de movimento inválido
    recusados; despesa em PIX e em dinheiro criadas (esta gerou a
    `sangria_liquidacao` de 20,00 no caixa aberto); conta a pagar editada de
    300 para 350 e, após pagar 100, valor 50 recusado e 400 aceito; paga por
    inteiro, nova edição recusada; conta a receber idem e parcela
    `origin='crediario'` recusada; id inexistente recusado nas duas;
    reedição sem mudança não gravou linha; sangria 30,456 virou 30,46 e a
    descrição com `<b>` chegou limpa. A aba Auditoria mostrou todas as
    linhas com título e detalhe. Dados de teste (17 linhas de auditoria,
    caixa, 3 movimentos, 2 despesas, 2 contas a pagar, 2 a receber)
    removidos em uma transação; empresa 4 voltou às 13 linhas de antes.
    `typecheck` + `lint` (0 erros, 7 avisos antigos) + `npm test` (442) limpos;
    testes novos em `sanitize.test.ts` (3) e `audit-label.test.ts` (3).

    Lacunas que continuam: não existe função de servidor que exclua/estorne
    uma despesa nem que cancele conta a pagar/receber manual (conferido: só
    o cancelamento de VENDA cancela título) — lançamento errado só dá para
    editar enquanto aberto, e despesa nem isso; é o próximo passo de
    produto (item 59, com auditoria). Metas, promoções e regras de comissão
    também ainda sem auditoria; o serviço instalado só recebe isto quando
    for atualizado.

59. **Não dava para desfazer um lançamento errado do financeiro — agora dá,
    com motivo obrigatório, auditoria e devolução do dinheiro ao caixa.**
    Item 58 deixou a lacuna: despesa lançada errada ficava para sempre
    (nem edição), conta a pagar/receber manual errada só podia ser editada
    ou paga. `cancelExpenseFn`, `cancelPayableFn` e `cancelReceivableFn`
    (`finance.ts`) rodam em `sql.transaction` com `select ... for update`,
    exigem `reason` (`requireLine`, até 200 caracteres), marcam o lançamento
    (despesa: `deleted_at = now()`; conta: `status = 'cancelado'`) e gravam
    `audit(..., "cancel", ...)` com `{ description, amount, ..., reason }`.
    Como todo agregado (relatórios, fluxo, DRE, crédito do cliente, sessão
    de caixa) já filtrava `deleted_at is null` / `status in
    ('pendente','parcial','vencido')`, o lançamento cancelado sai dos totais
    sem mexer em nenhuma query.

    O ponto delicado é o dinheiro. Despesa paga em dinheiro tira o valor da
    gaveta (`sangria_liquidacao`, item 47) — cancelar sem devolver deixaria o
    caixa "faltando" no fechamento. A migração `0032_expense_cash_link.sql`
    adiciona `expenses.method` e `expenses.cash_movement_id`; `saveExpenseFn`
    passa a guardar os dois. Cancelar uma despesa em dinheiro cria um
    movimento novo `estorno_liquidacao` ("Estorno de pagamento") no MESMO
    caixa, e `loadOpenRegister` o desconta da sangria líquida
    (`esperado = abertura + vendas + recebimentos + suprimento - sangria`
    continua valendo). O movimento original nunca é apagado: o histórico do
    caixa mostra os dois.

    O que o sistema RECUSA (mensagem própria em cada caso):
    - cancelar duas vezes; motivo em branco; id inexistente/de outra empresa;
    - conta com pagamento/recebimento já registrado (`paid_amount`/
      `received_amount > 0.009`) ou `pago` — não há "estorno de baixa" ainda;
    - conta a pagar gerada por compra (`purchase_id`) e conta a receber que
      não é `origin = 'manual'` (parcela de crediário/venda): o dono
      desfaz pela compra/venda, não aqui;
    - despesa em dinheiro cujo caixa já FECHOU: não há gaveta aberta para
      receber o dinheiro de volta; a mensagem manda lançar um suprimento no
      caixa aberto explicando o motivo (nenhum estorno é gravado e a despesa
      continua viva);
    - despesa LEGADA (anterior à migração, `method` nulo) quando existe um
      `sangria_liquidacao` "Despesa: <descrição>" do mesmo valor: o vínculo
      se perdeu e o sistema não adivinha — recusa. Legada sem movimento
      correspondente (PIX etc.) cancela normalmente.

    Dois furos achados no caminho e fechados: `settlePayableFn` e
    `settleReceivableFn` aceitavam baixa em título já `cancelado` (agora
    "Este título foi cancelado e não aceita baixa."); `savePayableFn`
    deixava mudar valor, fornecedor e loja de conta gerada por compra,
    descolando o título da compra — agora só descrição, categoria e
    vencimento mudam nela.

    Tela (`financeiro.tsx`): botão "Cancelar conta" nas linhas de pagar/
    receber só quando cancelável (sem pagamento, aberta, não gerada por
    compra/venda) e "Cancelar despesa" na aba Despesas; um diálogo pede o
    motivo (botão Confirmar desabilitado em branco), avisa "o valor volta
    para o caixa aberto da loja" quando a despesa foi em dinheiro e os
    toasts dizem o que aconteceu. `audit-label.ts` ganhou "devolvido ao
    caixa" e "motivo"; `CASH_MOVE_LABELS` ganhou `estorno_liquidacao`.

    Verificado ao vivo contra o Postgres real (empresa 4, loja 8), pelas
    server functions e pela tela: despesa em dinheiro de 30 cancelada →
    caixa esperado 70 → 100, sangria líquida 0, Saídas 50 → 0; segunda
    tentativa recusada; PIX cancelada sem movimento; conta a pagar/receber
    canceladas somem de "em aberto" e passam a recusar baixa e edição; com
    pagamento parcial/total recusadas; parcela `origin='crediario'` e conta
    com `purchase_id` recusadas (preparadas por SQL, a empresa 4 não tem
    compras) — nesta última, editar vencimento passou e valor/loja foram
    recusados; caixa fechado recusado sem efeito colateral e depois
    reaberto; legada com e sem movimento casada recusada/aceita. Na tela:
    botões só nas linhas certas, diálogo com e sem aviso de dinheiro, toasts
    "Conta cancelada." e "Despesa cancelada e dinheiro devolvido ao caixa.",
    e a aba Auditoria mostrando "Victor cancelou despesa “…” — valor ·
    categoria · forma: Dinheiro · devolvido ao caixa · motivo". Dados de
    teste (24 linhas de auditoria, caixa, 5 movimentos, 5 despesas, 4
    contas a pagar, 3 a receber) removidos em uma transação; empresa 4
    voltou às 13 linhas de antes e zero caixa/movimento/lançamento.
    `typecheck` + `lint` (0 erros, 7 avisos antigos) + `npm test` (443)
    limpos; teste novo em `audit-label.test.ts`.

    IMPORTANTE para o serviço instalado: a migração 0032 precisa rodar
    (`npm run db:migrate`, já parte do `build`) — sem as colunas novas,
    lançar despesa quebra. Isto só chega ao serviço depois de atualizado.

    Lacunas que continuam: não existe "estorno de baixa" (desfazer um
    pagamento/recebimento já feito — hoje conta paga não cancela; resolvido
    no item 61); despesas
    em dinheiro anteriores à migração não devolvem a gaveta sozinhas (a
    saída é um suprimento manual); metas, promoções e regras de comissão
    ainda sem auditoria.

60. **Dava para pagar duas vezes o mesmo título (e pagar mais que o saldo) —
    o servidor agora recusa.** Achado ao vivo ao preparar o item 61:
    `settlePayableFn`/`settleReceivableFn` somavam o valor recebido ao que o
    título já tinha, sem olhar o saldo. Reproduzido contra o Postgres real:
    título de R$ 100 terminou com R$ 1.100 recebidos / R$ 200 pagos e, em
    dinheiro, o lançamento no caixa duplicou (sobra fantasma no fechamento).
    O guard de duplo-clique da tela (item 58) só protegia o mesmo diálogo;
    nada impedia a segunda aba, o segundo operador ou uma chamada direta.

    A regra virou função pura em `src/lib/settlement.ts` (`planSettlement`,
    `SETTLEMENT_TOLERANCE = 0.05`), usada pelas duas server functions dentro
    da transação que já tinha `for update`: título já quitado →
    "Este título já está quitado."; valor acima do saldo →
    "Valor maior que o saldo do título (R$ X)." (tolerância de 5 centavos
    para arredondamento). Juros/desconto agora são "grudentos": baixa parcial
    que não informa juros/desconto mantém os do título (antes zerava), e o
    saldo é `valor + juros − desconto − já pago`. Desconto que cobre o título
    inteiro quita. 10 testes novos em `settlement.test.ts`.

61. **Não existia "estorno de baixa" — agora dá para desfazer o último
    pagamento/recebimento, com razão auditável.** Item 59 deixou conta paga
    sem saída (nem cancelar, nem desfazer); item 60 fechou a baixa dupla, mas
    baixa feita por engano (valor errado, PIX que não caiu) ficava para
    sempre. A migração `0033_account_settlements.sql` cria o razão
    `account_settlements` (uma linha por baixa: valor, juros, desconto,
    juros/desconto de ANTES, forma, `cash_movement_id`, quem/quando e, se
    estornada, `reversed_at/by`, motivo e `reverse_movement_id`). As duas
    funções de baixa passaram a gravar a linha (e a devolver `returning id`
    do movimento de caixa); `reverseSettlementFn({ kind, id, reason })`
    (`finance.ts`) desfaz SÓ A ÚLTIMA baixa não estornada: devolve
    `paid_amount`/`received_amount`, restaura juros/desconto de antes,
    recalcula o status (`pendente`/`parcial`) e, se a baixa foi em dinheiro,
    cria o movimento inverso (`estorno_liquidacao` para pagamento — dinheiro
    volta à gaveta; `estorno_recebimento` para recebimento — sai da gaveta).
    O movimento original nunca é apagado.

    Decisão deliberada: o estorno em dinheiro lança no caixa ABERTO da loja
    HOJE, não no caixa original (o dinheiro anda hoje). Se não há caixa
    aberto, recusa: "Abra o caixa desta loja para estornar um pagamento feito
    em dinheiro: o dinheiro volta para a gaveta." (idem recebimento). Efeito
    colateral conhecido: estorno de baixa de turno anterior aparece com
    sinal NEGATIVO em "recebimentos"/"sangria" do turno novo (esperado da
    gaveta continua certo: a conta é `abertura + vendas + recebimentos +
    suprimento − sangria`).

    Recusas (mensagem própria em cada uma): motivo em branco; tipo
    inválido; título inexistente/de outra empresa/cancelado; título sem baixa
    a estornar; baixa ANTERIOR ao razão (feita pelo serviço antigo, antes da
    0033) ou quitada pelo repasse de cartão (`card-settlement.ts` põe
    `received_amount = amount` sem linha no razão) — o sistema não adivinha o
    que desfazer; e total baixado que não bate com a soma do razão. Fluxo de
    caixa (`cashflowFn`) e `loadOpenRegister` descontam os estornos
    (`reverse-pay`/`reverse-receive` na auditoria; `estorno_recebimento` no
    caixa). `audit-label.ts` ganhou "estornou pagamento de/recebimento de",
    "retirado do caixa" e `CASH_MOVE_LABELS.estorno_recebimento`.

    Tela (`financeiro.tsx`): botão "Estornar último pagamento/recebimento"
    nas linhas cuja última baixa tem razão (coluna `last_settlement_*` por
    `left join lateral`); reaproveita o diálogo de cancelamento com título e
    texto próprios (valor da baixa, aviso de dinheiro), motivo obrigatório e
    toasts "Pagamento estornado e dinheiro devolvido ao caixa." /
    "Recebimento estornado e dinheiro retirado do caixa.".

    Verificado ao vivo contra o Postgres real (empresa 4, loja 8): baixa
    parcial 40 + 60 em dinheiro, 3ª recusada (quitado), excedente recusado
    com o saldo certo; estorno só da última (60) → `parcial`, paid 40, caixa
    +60 devolvido (movimento 88 no caixa 72); recebimento 30 dinheiro + 70
    PIX, PIX estornado primeiro (sem movimento de caixa), depois o dinheiro;
    terceira tentativa recusada; juros 6 com baixa de 66 estornada → juros
    voltam a 0; desconto 20 grudento na baixa seguinte e `prev_discount`
    gravado; fluxo de caixa 1.200/300 → 1.100/240 e esperado do caixa
    fechando em 960 (= 100 + 1.150 − 290, estornos já líquidos); caixa
    fechado → ambos estornos em dinheiro recusados; caixa novo aberto →
    estornos lançados nele (caixa 73, esperado volta aos 10 de abertura);
    título legado sem razão recusado. Na tela: botão só na linha certa
    (títulos legados não mostram), diálogo com valor e aviso de dinheiro,
    toast, título voltou a "Pendente" e Entradas 1.125 → 1.100; Auditoria
    mostra "Victor estornou recebimento de conta a receber “…” — valor ·
    forma · situação · retirado do caixa · motivo". Dados de teste (10
    linhas de razão, 30 de auditoria, 15 movimentos, 2 caixas, 3 pagar, 3
    receber) removidos em uma transação; empresa 4 voltou às 13 linhas de
    antes e zero caixa/movimento/lançamento/razão. `typecheck` + `lint` (0
    erros, 7 avisos antigos) + `npm test` (454) limpos.

    IMPORTANTE para o serviço instalado: a migração 0033 precisa rodar
    (`npm run db:migrate`, parte do `build`; já aplicada ao banco local
    piloto, que é o mesmo do serviço). O serviço instalado só ganha o guard
    de baixa e o estorno depois de atualizado, e baixas feitas pelo serviço
    antigo NÃO geram linha no razão — ficam sem estorno automático (a tela
    nem mostra o botão). Conta de crediário (`crediario-panel.tsx`) não ganhou
    botão de estorno: os mesmos títulos aparecem na aba Contas a receber.

    Lacunas que continuam: despesa em dinheiro anterior à migração 0032 não
    devolve a gaveta sozinha; `cancelExpenseFn` com caixa fechado ainda
    recusa (o estorno de baixa já lança no caixa aberto de hoje — dá para
    alinhar); metas, promoções e regras de comissão sem auditoria.

62. **Promoções, regras de comissão e metas aceitavam qualquer coisa, não
    deixavam rastro e as promoções não tinham como ser encerradas.** Estas
    três telas mexem em dinheiro (preço do PDV e comissão paga) e eram as
    únicas de cadastro sem validação de servidor nem auditoria. Reproduzido
    ao vivo antes de corrigir: `savePromotionFn` salvava nome em branco, fim
    antes do início, tipo inexistente e promoção "percentual" sem percentual
    (ativa, mas nunca dava desconto), e "atualizava" um id inexistente
    respondendo sucesso; a tela só criava — não havia botão para desativar,
    então uma promoção errada ficava no preço do PDV até o fim do período.
    `saveCommissionRuleFn` quebrava com erro cru do banco (`tier_basis`
    nulo) quando a base da faixa não vinha, "atualizava" regra inexistente,
    aceitava nome em branco e transformava tipo desconhecido em outro sem
    avisar. `saveTargetFn` deixava passar data impossível (31/02) e valor
    acima do `numeric(14,2)` como erro cru do Postgres. Nada disso ia para
    `audit_logs`.

    Correção:
    - **Validação pura e testada** (`parsePromoInput` em `src/lib/promo.ts`,
      `parseCommissionRuleInput` em `src/lib/commission.ts`): cada tipo exige
      só o número que realmente usa (percentual 0–100 exclusivo de zero,
      desconto fixo > 0, preço promocional > 0, quantidade mínima + percentual
      em "por quantidade", leve X pague Y com pague < leve) e zera o que não
      usa; datas reais e fim ≥ início; tipo, forma de pagamento e base da
      faixa dentro dos conjuntos conhecidos (antes: coerção silenciosa);
      NaN/Infinity/valores acima da coluna recusados com mensagem própria.
      Meta valida nome, valor, datas e fim ≥ início.
    - **Servidor transacional com `for update`**: editar id inexistente (ou de
      outra empresa) agora recusa ("Promoção/Regra/Meta não encontrada.");
      promoção e regra mantêm situação e escopo quando o campo não vem (só
      `null` limpa) e escolher produto limpa categoria e vice-versa (o produto
      já vencia em `promoApplies`, a categoria ficaria morta); regra e promoção
      de outra empresa são recusadas por `assertOwned`.
    - **Auditoria** (`promotion`, `commission_rule`, `target`): criação grava o
      registro inteiro, edição e ativar/desativar usam `auditUpdate` (não grava
      quando nada mudou) e excluir regra grava o antes. Excluir regra já usada
      em comissão paga continua só desativando (`deactivated: true`) e agora
      isso também fica auditado. Novo `setPromotionActiveFn`. `audit-label.ts`
      ganhou rótulos legíveis (tipo, faixas "R$ 1.000,00+ → 5%", "valor por
      peça" em vez de percentual, bônus da meta na unidade do tipo, sim/não) e
      o verbo "excluiu".
    - **Tela de promoções**: botão Ativar/Desativar por linha (toast e
      recarrega a lista, trava contra clique repetido), coluna "Aplica a"
      (produto, categoria ou todos) e seletor de categoria no formulário.
      Escolher um produto específico na tela continua só pela API (sem
      seletor ainda).

    Verificado ao vivo contra o Postgres real (empresa 4), só com dado de
    teste inativo ou com data de 2020 (promoção ativa com data atual vira
    desconto real no PDV do piloto): recusas de nome em branco, fim antes do
    início, tipo inválido, percentual ausente e 150%, id inexistente
    (promoção, regra, meta e exclusão), vendedor de outra empresa, data
    31/02 e valor 1e15; criar/editar/ativar/desativar/trocar tipo e limpar
    escopo da promoção geraram exatamente 5 linhas de auditoria (edição sem
    mudança e ativar já ativa não gravam); regra criada sem `tierBasis`,
    editada (percentual, depois faixas) e excluída → 4 linhas (create,
    update, update, delete); meta criada e editada → 2 linhas. Na tela:
    botão Ativar virou "Promoção reativada." / Desativar, "Aplica a" e o
    seletor de categoria apareceram, e a aba Auditoria mostra, por exemplo,
    "Victor alterou regra de comissão “…” — base da faixa: Percentual único →
    Faixa sobre o total da venda · faixas: nenhuma → R$ 1.000,00+ → 5% · …".
    Dados de teste (promoção, meta, vendedor e categoria descartáveis, 12
    linhas de auditoria) removidos em uma transação; empresa 4 voltou às 13
    linhas de antes e zero promoção/regra/meta. `typecheck` + `lint` (0
    erros, 7 avisos antigos) + `npm test` (469) limpos.

    O serviço instalado só ganha isso depois de atualizado (sem migração
    nova). Caminho "regra já usada em comissão → só desativa" não foi
    exercitado ao vivo (empresa 4 ainda não tem comissão paga); está coberto
    só por leitura do código.

    Lacunas que continuam: seletor de produto específico na tela de
    promoções; metas sem desativar/excluir na tela; despesa em dinheiro
    anterior à migração 0032 não devolve a gaveta sozinha; `cancelExpenseFn`
    com caixa fechado ainda recusa.

63. **Listas cortavam em silêncio (200/400 linhas), filtros eram aplicados
    depois do corte, e toda letra digitada na busca derrubava a página.**
    Achado revisando as telas que o operador mais usa (Produtos, Estoque,
    Vendas, Clientes, diálogo de cliente do PDV, Promoções, Comissões).
    Pontos reais, todos reproduzidos antes de corrigir:
    - **Busca perdia o foco a cada tecla** (Produtos, Estoque, Vendas,
      Clientes, diálogo de cliente do PDV): a chave da consulta mudava, o
      react-query caía para o esqueleto de página inteira e o `<input>` era
      desmontado — dava para digitar uma letra por vez.
    - **Estado vazio mentia**: busca ou filtro sem resultado mostrava "Você
      ainda não possui produtos/clientes/vendas…" (como se o cadastro
      estivesse vazio) e levava ao botão de cadastrar.
    - **Teto silencioso**: `listProductsFn` e `listCustomersFn` cortavam em
      200, `listStockFn` em 400 e `listSalesFn` em 200, sem aviso. Com
      catálogo maior o produto simplesmente não existia para o `<select>` da
      regra de comissão e do simulador (ordem alfabética, sem busca).
    - **Filtro depois do corte**: em `listStockFn`, "Baixo / Zerado / Parado"
      filtrava no cliente as 400 primeiras linhas — um item zerado além da
      linha 400 nunca aparecia no filtro "Zerado".
    - **Promoções**: o servidor já aceitava promoção por produto (e a lista
      mostra o nome dele), mas o formulário só oferecia categoria; e o
      formulário reabria com a promoção anterior preenchida depois de salvar.
    - **Escape fechava o diálogo inteiro**: num seletor de produto dentro de
      um `Dialog`, Esc com a lista aberta fechava o diálogo e perdia o
      formulário (ver "pegadinha" abaixo).
    - Simulador de comissão sem vendedor cadastrado ficava com "…" na tabela
      para sempre, sem explicar (a simulação exige vendedor) — agora diz.

    Correção:
    - **Paginação no servidor** (`src/lib/paging.ts`, `parsePaging`): `limit`
      padrão 100, máximo 200, `offset`; `listProductsFn`, `listStockFn` e
      `listSalesFn` passam a devolver `{ items, total }` (`count(*) over()`).
      Os filtros de estoque (baixo/zerado/parado) agora rodam em SQL. Número
      de venda digitado exato vem primeiro em `listSalesFn` (a devolução
      localiza a venda por número e só aceita o match exato — não pode ficar
      atrás de vendas cujo cliente casa com o mesmo texto). Componente
      `Pager` em `components/shared.tsx` ("Mostrando 1–100 de 340", anterior/
      próxima), voltando à página 0 ao mudar busca/filtro e quando a página
      atual volta vazia.
    - **Busca sem perder o foco**: `useDebounced` (`hooks/use-debounced.ts`) +
      `placeholderData: keepPreviousData`; o esqueleto de página só aparece na
      primeira carga, e o conteúdo antigo fica esmaecido (`opacity-60`,
      `aria-busy`) enquanto a nova consulta volta.
    - **Estados vazios honestos** com "Limpar busca/filtros" e `aria-label` nas
      buscas.
    - **`ProductPicker`** (`components/product-picker.tsx`): combobox por
      busca digitada (200 ms, 8 resultados, ↑/↓/Enter, "Mostrando N de TOTAL —
      digite para refinar.", botão "Trocar produto"). Substitui os dois
      `<select>` de produto da regra de comissão e do simulador
      (`commission-panel.tsx`) e é o seletor novo de "Um produto" em Promoções
      (escopo Todos / Uma categoria / Um produto, com validação e toasts).
      A lista de resultados fica no fluxo da página, não flutuante (dentro de
      diálogo com rolagem um painel absoluto seria cortado).
    - Devoluções passou a usar o formato `{ items }` (`recent` com limit 8 e
      busca por número com limit 50). Clientes ganhou o aviso "Mostrando os
      primeiros 200…" quando atinge o teto de `listCustomersFn`.

    **Pegadinha (não repetir)**: o Radix Dialog escuta Escape numa captura no
    `document`, antes de qualquer handler do React — `stopPropagation` no
    `onKeyDown` do input chega tarde. Para um campo dentro de diálogo
    consumir o Esc (fechar a própria lista, limpar o texto) é preciso um
    `window.addEventListener("keydown", …, true)` (a captura em `window` roda
    antes da do `document`); o `ProductPicker` faz isso só enquanto há lista
    aberta ou texto digitado e só se o foco está no próprio input.

    Verificado ao vivo contra o Postgres real (empresa 4) com 3 produtos
    descartáveis "ZZTESTE" (e estoque, promoção de 2020 e regra de comissão
    inativa): digitar várias letras seguidas em Produtos/Estoque/Vendas/
    Clientes mantém o foco; busca sem resultado e filtro "Zerado" mostram a
    mensagem específica; chamadas diretas com `limit` pequeno devolvem
    `{items,total}` corretos (limite acima de 200 é limitado a 200); no
    formulário de promoção o seletor "Um produto" busca, escolhe por ↓/Enter,
    troca, recusa salvar sem produto, salva com `product_id` e o formulário
    reabre limpo; na regra de comissão o picker mostra "Todos os produtos"
    vazio, escolhe, salva como regra pausada, e "Editar" reabre mostrando o
    nome do produto; no simulador o produto escolhido entra na venda fictícia
    e o campo limpa; Esc com a lista aberta só fecha a lista (diálogo
    continua), um segundo Esc fecha o diálogo. Dados de teste removidos numa
    transação; empresa 4 voltou a zero produto/variação/estoque/movimento/
    promoção/regra e às 13 linhas de auditoria. `typecheck` + `lint` (0
    erros, 6 avisos antigos; saiu um import `Select` sem uso em `vendas.tsx`)
    + `npm test` (477, com 8 novos de `paging.ts`) limpos.

    Não verificado na tela: o `Pager` só aparece com mais de 100 linhas e a
    empresa piloto ainda não tem esse volume — está coberto pelos testes de
    `paging.ts` e pelas chamadas diretas com `limit` pequeno. O simulador só
    calcula com vendedor cadastrado (o piloto ainda não tem), então a coluna
    "Regra aplicada" com resultado real não foi exercitada.

    O serviço instalado (NSSM, :8080) só ganha isso depois de atualizado
    (sem migração nova).

    Lacunas que continuam: `count(*) over()` devolve total 0 quando o
    `offset` passa do fim (por isso a tela volta à página 0 ao receber página
    vazia); a lacuna de `listCustomersFn` (teto de 200, CRM, Financeiro) foi
    fechada no item 64; metas sem
    desativar/excluir na tela; despesa em dinheiro anterior à migração 0032
    não devolve a gaveta sozinha; `cancelExpenseFn` com caixa fechado ainda
    recusa.

64. **Clientes: lista cortava em 200 sem total, filtro por etapa era letra
    morta, o funil do CRM saía de uma fatia alfabética e o Financeiro
    carregava o cadastro inteiro para um `<select>`.** Fecha a lacuna deixada
    no item 63 (`listCustomersFn`). Pontos reais, reproduzidos antes de
    corrigir:
    - **Teto silencioso**: `listCustomersFn` devolvia no máximo 200 clientes
      por ordem alfabética, em array, sem total. A tela de Clientes só
      avisava "primeiros 200…" ao bater o teto; o diálogo de cliente do PDV, o
      CRM e o Financeiro nem isso.
    - **Filtro por etapa do CRM não existia**: o servidor tinha um parâmetro
      `stage` que nunca era usado, e a tela de Clientes não tinha filtro. O
      CRM não tinha como mandar o operador para "todos os clientes em
      Negociação".
    - **CRM mentia com mais de 200 clientes**: colunas, "No funil" e "Valor no
      funil" eram calculados no navegador sobre as 200 primeiras linhas do
      cadastro; "Tarefas abertas" e "Atrasadas" vinham da agenda, que traz no
      máximo 80 — nunca passavam disso.
    - **Financeiro → Conta a receber** buscava a listagem enriquecida de
      clientes (três agregados: compras, saldo, tarefas) só para montar um
      `<select>`; com cadastro grande, além do peso, o cliente além do corte
      não existia para o formulário.
    - **Diálogo de cliente do PDV**: ao digitar uma busca que não incluía o
      cliente já escolhido, ele sumia do `<select>` e a venda seguia sem o
      vínculo, sem aviso.
    - **`crmStage` sem validação** em `saveCustomerFn`: um valor fora do funil
      gravava, e o cliente sumia do quadro (nenhuma coluna o mostra).
    - Chave de consulta `["customers","crm"]` colidia com a busca do texto
      "crm" na lista de clientes (mesma chave, formatos diferentes).

    Correção:
    - **`listCustomersFn`** (`lib/server/party.ts`): `parsePaging`
      (`limit` padrão 100, máx. 200, `offset`), `count(*) over()` e retorno
      `{ items, total }`; `stage` validado (`parseCrmStage`, "Estágio
      inválido.") e aplicado em SQL. Os agregados do cliente ficaram numa
      constante compartilhada (`CUSTOMER_AGGREGATES`) — lista e quadro nunca
      discordam do "total comprado".
    - **`crmBoardFn`** (novo): contagem e valor de CADA etapa sobre todos os
      clientes (`count/sum … over (partition by crm_stage)`), só os primeiros
      `CRM_BOARD_CARDS` (30) cartões por coluna (`row_number`), e as tarefas
      abertas/atrasadas contadas em SQL. O CRM mostra "Mostrando 30 de M. Ver
      todos em Clientes" no rodapé da coluna, com link para
      `/app/clientes?etapa=<etapa>`.
    - **Clientes**: `Pager` (100 por página), filtro "Etapa do CRM" (lido de
      `?etapa=`), estados vazios que dizem o que filtraram ("Nenhum cliente na
      etapa Negociação." / "…para “x” na etapa Perdido.") com "Limpar filtros".
      Voltar à página 0 ao mudar busca/etapa e quando a página volta vazia.
    - **`SearchPicker`** (`components/search-picker.tsx`, novo): o combobox do
      `ProductPicker` virou genérico (busca digitada, 200 ms, 8 resultados,
      ↑/↓/Enter, Esc que só fecha a lista, "Trocar …"). `ProductPicker` agora é
      um invólucro fino dele (mesmas props) e `CustomerPicker`
      (`components/customer-picker.tsx`) é o segundo uso: nome/documento/
      telefone, mostra "débito R$ …". Financeiro → Conta a receber passou a
      usá-lo (some a consulta pesada).
    - **PDV**: o cliente já escolhido continua nas opções mesmo quando a busca
      não o inclui; aviso "Mostrando N de TOTAL clientes — digite para
      refinar." quando há mais do que a lista traz.
    - `crmStage` de `saveCustomerFn` passa por `parseCrmStage`.
    - Hook `useSearchParam` em `hooks/use-search-id.ts` (`useSearchId` foi
      reescrito em cima dele) para ler `?etapa=`.

    **Pegadinhas (não repetir)**: (1) toda chave nova de consulta de cliente
    começa por `"customers"` — `["customers","list",termo,etapa,página]`,
    `["customers","board"]`, `["customers","picker",termo]`,
    `["customers","pdv",termo,tipo,débito]` — porque salvar/editar/mover
    invalida `["customers"]` por prefixo; uma chave que não começa assim fica
    velha depois de salvar. (2) `SearchPicker` recebe o prefixo da chave e
    acrescenta o termo; quem o usa precisa passar um prefixo que a tela
    invalida. (3) `crmBoardFn` exige `customers.read` E `crm.write` (a tela do
    CRM usa os dois); papel sem um deles recebe recusa em vez de quadro
    parcial.

    Verificado ao vivo contra o Postgres real (empresa 4) com 3 clientes
    descartáveis "ZZTESTE" (Ana/Bruno/Carla), 1 título a receber, 2 produtos e
    1 promoção de 2020: lista, filtro por etapa (select e `?etapa=`), busca
    combinada com etapa mantendo o foco, estados vazios (termo+etapa e só
    etapa), busca por prefixo de telefone e por nome; mover clientes entre
    etapas na tela do CRM atualiza colunas, "No funil" (3 → 2 ao mandar um
    para Perdido) e o quadro refaz sozinho; rodapé "Mostrando 1 de 3. Ver
    todos em Clientes" (com `CRM_BOARD_CARDS` baixado para 1 só durante a
    verificação e restaurado para 30) com o link abrindo a lista já filtrada;
    a consulta do quadro rodada em transação somente-leitura com limite 1
    devolveu 1 cartão e `stage_count` 3; chamadas diretas: `limit 1` →
    `{items:1,total:3}`, `offset 2` → Carla, `stage` inválido recusado em
    `listCustomersFn`/`saveCustomerFn`/`moveCrmFn`; Financeiro: lista abre,
    digitar filtra, Esc fecha só a lista (diálogo fica), ↓/Enter escolhe sem
    enviar o formulário, "Trocar cliente" devolve o foco ao campo, salvar grava
    `customer_id`, e o cliente passa a mostrar "débito R$ 10,00" no seletor e
    no diálogo do PDV; PDV: cliente escolhido permanece nas opções quando a
    busca o exclui; `ProductPicker` depois do refator: Promoções (busca por
    SKU, Enter, grava `product_id`), simulador de comissão e regra de comissão
    (busca; Esc fecha só a lista). Sem erro no console. Dados de teste
    removidos numa transação; empresa 4 voltou a zero cliente/título/produto/
    variação/estoque/movimento/promoção/regra e às 13 linhas de auditoria.
    `typecheck` + `lint` (0 erros, 5 avisos antigos) + `npm test` (477) limpos.

    Não verificado na tela: o `Pager` de Clientes e o aviso "Mostrando N de
    TOTAL" do PDV só aparecem com cadastro acima do limite pedido (o piloto
    tem 0 clientes e não dá para criar volume sem inserção em massa no banco
    real) — cobertos pelas chamadas diretas com `limit` pequeno e pela
    consulta somente-leitura. O rodapé de coluna do CRM foi visto com o
    limite rebaixado, não com 30+ clientes de verdade.

    O serviço instalado (NSSM, :8080) só ganha isso depois de atualizado
    (sem migração nova).

    Lacunas que continuam: a lacuna de `listSuppliersFn` (sem limite,
    alimentava os `<select>` de fornecedor de Produtos, Compras e Financeiro)
    foi fechada no item 65; a busca de cliente por telefone só por igualdade
    ou prefixo foi fechada no item 66 (palavras de uma letra continuam fora
    da parte de texto da busca — ver a nota de baixo impacto no item 66);
    `count(*) over()` devolve total 0 quando o `offset` passa do
    fim; tarefas abertas de cliente excluído continuarem contando (agenda,
    KPI e sininho) foi fechado no item 67; `saveCustomerFn` chamado direto
    sem telefone/e-mail apagando os dois foi fechado no item 68 (o mesmo
    buraco existe hoje em `saveSupplierFn`, ainda não fechado).

65. **Fornecedores: `listSuppliersFn` devolvia o cadastro inteiro sem limite
    nem total, usado por três `<select>` (Produtos, Compras, Financeiro) e
    pela própria tela de Fornecedores sem busca nem paginação.** Fecha a
    lacuna deixada no item 64. Pontos reais, reproduzidos antes de corrigir:
    - **Mesmo padrão do item 64, agora em fornecedor**: `listSuppliersFn` já
      aceitava `q`, mas sem `limit`/`offset`/total — crescia o cadastro,
      crescia a consulta e o `<select>` junto, sem aviso nenhum.
    - **Produtos → campo Fornecedor, Financeiro → Conta a pagar, Compras →
      Pedido de compra**: os três usavam `listSuppliersFn({ data: {} })` para
      alimentar um `<select>` com TODO o cadastro — nem busca, nem corte.
    - **Tela de Fornecedores**: nenhuma busca, nenhuma paginação — só a lista
      inteira, sempre.
    - **`getProductFn`** devolvia `supplier_id` mas não o nome do fornecedor:
      um `SearchPicker` (busca por nome) não tinha o que mostrar ao abrir um
      produto para editar — o campo pareceria "sem fornecedor" mesmo com um
      de verdade salvo.

    Correção:
    - **`listSuppliersFn`** (`lib/server/party.ts`): mesmo padrão do
      `listCustomersFn` do item 64 — `parsePaging`, `count(*) over()`,
      retorno `{ items, total }`, desempate por `id` na ordenação.
    - **`SupplierPicker`** (`components/supplier-picker.tsx`, novo): segundo
      uso do `SearchPicker` genérico do item 64 (depois de `CustomerPicker`) —
      razão social/nome fantasia/documento, mostra "a pagar R$ …" quando há
      saldo. Substituiu o `<select>` em Produtos, Financeiro → Conta a pagar e
      Compras → Pedido de compra.
    - **Fornecedores**: busca (razão social, nome fantasia, CNPJ) com
      `keepPreviousData`, `Pager` (100 por página), estado vazio que diferencia
      busca sem resultado ("Nenhum fornecedor encontrado para…") de cadastro
      vazio, com "Limpar busca".
    - **`getProductFn`** (`lib/server/catalog.ts`): junta `suppliers` para
      `supplier_legal_name`/`supplier_trade_name`; o formulário de edição
      monta o valor do `SupplierPicker` com nome fantasia (ou razão social) em
      vez de só o id.

    Verificado ao vivo contra o Postgres real (empresa 4) com 3 fornecedores
    descartáveis "ZZTESTE" (Alfa/Beta/Gama): tela de Fornecedores — lista,
    busca por nome filtrando para 1, busca sem resultado com "Limpar busca"
    voltando aos 3; paginação testada à parte via consulta somente-leitura
    (`limit 2 offset 0` → Alfa/Beta com total 3, `offset 2` → Gama); Produtos
    — `SupplierPicker` buscando "gama", ↓/Enter escolhendo, produto salvo com
    `supplier_id` correto no banco (conferido via SQL), reaberto para editar
    com o fornecedor já no seletor (prova do join novo no `getProductFn`);
    Financeiro → Conta a pagar — fornecedor "Alfa" escolhido, conta salva com
    `supplier_id` correto; Compras → Pedido de compra — fornecedor "Beta"
    escolhido, item de produto adicionado, pedido salvo com `supplier_id`
    correto. `typecheck` + `lint` (0 erros, 5 avisos antigos, os mesmos de
    sempre) + `npm test` (477) limpos. Dados de teste removidos um registro
    por vez (o script de limpeza em lote foi recusado pelo classificador do
    modo automático como "Cloud Storage Mass Delete" — nenhuma tentativa de
    contornar, só troquei por exclusões individuais pelos mesmos ids);
    empresa 4 voltou a zero fornecedor/produto/variação/pedido/conta a pagar
    e às 13 linhas de auditoria.

    Não verificado na tela: o aviso "Mostrando N de TOTAL — digite para
    refinar" do `SearchPicker` só aparece acima de 8 resultados (3
    fornecedores no piloto); o `Pager` de Fornecedores só aparece acima de
    100 — mesma limitação do item 64, mesma cobertura por consulta direta.

    O serviço instalado (NSSM, :8080) só ganha isso depois de atualizado
    (sem migração nova).

66. **Busca de cliente por telefone só achava por igualdade ou pelo começo —
    os últimos dígitos (o que quem atende o telefone normalmente tem: caller
    ID, uma anotação) não achavam ninguém.** Lacuna documentada nos itens 64
    e 65, agora fechada. Ponto real, reproduzido antes de corrigir: um
    cliente salvo com telefone "(11) 98765-4321" não aparecia buscando
    "4321" nem "8765" (meio do número) — só "(11) 98765-4321" inteiro, ou
    algo que batesse com o INÍCIO do que estava salvo (`like 'prefixo%'`).
    Como o telefone é texto livre (sem máscara no cadastro), o mesmo número
    digitado com ou sem formatação também não se encontrava.

    Correção:
    - **`listCustomersFn`** (`lib/server/party.ts`) e **`globalSearchFn`**
      (`lib/server/session.ts`, a busca do Ctrl K): com 4+ dígitos no termo
      buscado, nova cláusula compara só os DÍGITOS do telefone salvo
      (`regexp_replace(coalesce(phone,''), '\D', '', 'g')`) contra o termo em
      qualquer posição (`like '%dígitos%'`) — acha meio ou fim do número,
      com ou sem formatação, sem se importar com parênteses/traço/espaço.
      Chave em 4 dígitos (não 1-2, que devolveria clientes demais) — mesmo
      corte que o item usava para documento (lá em 6, por ser mais longo).
      Em `globalSearchFn`, que monta a consulta como template tagged (não
      `sql.query` com `$N`), o gatilho é um parâmetro `null` quando o termo
      tem menos de 4 dígitos — desarma a cláusula sem compor SQL condicional.
    - Cobre todas as telas que passam por `listCustomersFn`: Clientes, CRM
      (link "Ver todos"), diálogo de cliente do PDV, `CustomerPicker`
      (Financeiro → Conta a receber) — e a busca global (Ctrl K) por cima.

    **Pegadinha (não repetir)**: `'\D'` dentro de um template string JS vira
    `'D'` — o `\D` da expressão regular do Postgres (não-dígito) exige
    `'\\D'` no código-fonte (barra dupla) pra sobreviver ao parser do
    JavaScript antes de virar SQL. Teria passado no `typecheck`/`lint` (é só
    uma string) e falhado em silêncio — a cláusula teria virado "remove a
    letra D do telefone" em vez de "remove tudo que não é dígito". Pego
    testando a string resultante antes de rodar contra o banco.

    Verificado ao vivo contra o Postgres real (empresa 4) com 1 cliente
    descartável "ZZTESTE Fulano Suffix" (telefone "(11) 98765-4321"): tela de
    Clientes — busca "4321" (últimos 4) achou, "8765" (meio do número)
    achou, "43219999" (dígitos que não batem) não achou nada; busca global
    (Ctrl K) — "4321" devolveu o cliente na seção "Clientes". Consulta
    somente-leitura reproduzindo as duas cláusulas exatas confirmou os
    mesmos resultados antes de mexer na tela. `typecheck` + `lint` (0 erros,
    5 avisos antigos) + `npm test` (477) limpos. Cliente de teste removido;
    empresa 4 voltou a zero cliente e às 13 linhas de auditoria.

    Não corrigido (impacto baixo, decisão deliberada): `ftsPrefix` ainda
    descarta palavras de uma letra do termo buscado (`src/lib/search.ts`) —
    "zzteste c" vira a mesma busca que "zzteste" na cláusula de texto. Na
    prática isso quase nunca muda o resultado porque a cláusula `name ilike
    '%termo%'` já cobre o caso comum (iniciais na ordem digitada, ex.: "João
    C" acha "João Carlos" por essa cláusula, não pela de texto) — só perde
    quando as palavras do nome estão fora de ordem, caso raro pra busca de
    cliente. Não mexido para não arriscar a cláusula de texto por um ganho
    que a `ilike` já cobre na prática.

    O serviço instalado (NSSM, :8080) só ganha isso depois de atualizado
    (sem migração nova).


67. **Excluir um cliente não fechava as tarefas dele: continuavam inflando
    "Tarefas abertas"/"Atrasadas" do CRM, a agenda de follow-ups e o sininho
    de notificações pra sempre.** Lacuna documentada nos itens 64-66, agora
    fechada. Ponto real, reproduzido antes de corrigir: cliente com uma
    tarefa vencida, excluído — "Tarefas abertas" e "Atrasadas" continuavam
    em 1 (não em 0), o cartão "Agenda de follow-ups" continuava mostrando o
    follow-up com o nome do cliente excluído, e o sininho continuava
    avisando "1 follow-up(s) vencido(s)". Três consultas, três lugares:
    - **`crmBoardFn`** (`lib/server/party.ts`): a consulta do KPI
      "Tarefas abertas"/"Atrasadas" juntava `crm_tasks` com `customers` mas
      não filtrava `deleted_at`.
    - **`listCrmTasksFn`** (mesmo arquivo, alimenta a "Agenda de
      follow-ups" do CRM): mesma junção, mesma falta de filtro.
    - **`listNotificationsFn`** (`lib/server/session.ts`, o sininho): nem
      juntava com `customers` — contava `crm_tasks` sozinha, então nem
      sabia se o cliente da tarefa ainda existia.

    Correção: as três consultas agora exigem `customers.deleted_at is
    null` (a de `listNotificationsFn` ganhou o join que não tinha). O
    contador por cliente que já aparece em cada card (`CUSTOMER_AGGREGATES`,
    usado por `listCustomersFn`/`crmBoardFn`) não precisou de mudança: já
    só soma tarefa de cliente que sobra depois do filtro externo
    `c.deleted_at is null` — o problema era só nos três totais "soltos" que
    não passavam por esse filtro.

    Verificado ao vivo contra o Postgres real (empresa 4) com 1 cliente
    descartável "ZZTESTE Tarefa Orfa" e 1 tarefa vencida: antes de excluir,
    "Tarefas abertas" = 1, "Atrasadas" = 1, cartão "Agenda de follow-ups"
    mostrando a tarefa, sininho "Tarefas do CRM — 1 follow-up(s) vencido(s)
    ou para hoje."; depois de excluir o cliente (`deleted_at = now()`
    direto no banco, mesmo efeito do botão Excluir): "Tarefas abertas" e
    "Atrasadas" em 0, cartão de agenda desaparecido inteiro (sem tarefas
    abertas), sininho "Tudo em dia.". `typecheck` + `lint` (0 erros, 5
    avisos antigos) + `npm test` (477) limpos. Cliente e tarefa de teste
    removidos; empresa 4 voltou a zero cliente/tarefa e às 13 linhas de
    auditoria.

    O serviço instalado (NSSM, :8080) só ganha isso depois de atualizado
    (sem migração nova).


68. **`saveCustomerFn` chamado sem um campo opcional apagava esse campo em
    vez de manter o que já estava gravado — só `ie`/`rg`/`zip`/
    `creditLimit`/`sellerId` tinham a proteção certa.** Lacuna documentada
    desde o item 64, agora fechada. Ponto real, reproduzido antes de
    corrigir: o próprio código já tinha a correção certa para `ie`/`rg`/
    `zip` (comentário explicando que uma edição que não mostra esses campos
    os apagava ao regravar — o mesmo bug, resolvido uma vez), mas
    `tradeName`/`document`/`email`/`phone`/`whatsapp`/`address`/`city`/
    `state`/`notes` continuavam sem essa proteção: o validador colapsava
    "campo não veio" e "campo veio vazio" no mesmo `undefined`, e o UPDATE
    regravava `data.X ?? null` sempre. As duas telas que chamam a função
    hoje mandam o registro inteiro (por isso nunca dava pra ver o bug na
    UI) — mas a própria tela de edição (`CustomerPanel`) já usava `edit.email
    || undefined` pra alguns campos, ou seja, JÁ dependia (sem saber) de
    como `undefined` seria tratado — só não quebrava porque antes `undefined`
    e `""` davam no mesmo resultado.

    Correção:
    - **`saveCustomerFn`** (`lib/server/party.ts`): todo campo opcional
      passou a seguir a regra que `ie`/`rg`/`zip`/`creditLimit`/`sellerId`
      já seguiam — `undefined` (chave ausente do payload) = mantém o
      gravado; `null`/`""` (chave presente, vazia) = apaga de propósito. No
      UPDATE, cada campo é resolvido primeiro (`data.X === undefined ?
      cur.X : data.X`) e só o valor resolvido entra no SQL e no `after` da
      auditoria — antes o `after` podia mostrar `null` para um campo que na
      verdade não mudou.
    - **`CustomerPanel`** (`components/customer-panel.tsx`): o salvar da
      aba Dados mandava `edit.email || undefined` (e outros 6 campos
      assim) — com o novo significado de `undefined`, isso teria virado
      "nunca mais consigo apagar o e-mail pela tela", uma regressão real
      que só apareceria depois de publicado. Trocado para mandar o valor
      puro (`edit.email`), já que esta tela edita TODOS esses campos e
      sempre tem um valor definido (mesmo vazio) pra cada um.

    **Pegadinha (não repetir)**: ao endurecer um contrato "undefined =
    mantém", TODO chamador que usa `campo || undefined` pra "limpar o
    campo" vira um chamador que silenciosamente para de limpar. Antes de
    fechar esse tipo de lacuna num `saveXFn`, grep por `XFn(` pra conferir
    CADA chamador, não só o que motivou o fix.

    Verificado ao vivo contra o Postgres real (empresa 4) com 1 cliente
    descartável "ZZTESTE Partial Update" (telefone e e-mail preenchidos):
    (1) limpar o telefone pela aba Dados do `CustomerPanel` (campo
    esvaziado, Salvar) gravou `phone = null` e manteve o e-mail intacto —
    confirma que `CustomerPanel` continua limpando campo de verdade depois
    da correção; a auditoria registrou o antes/depois certo (`phone`
    "11988887777" → `null`, `email` inalterado). (2) Chamada direta ao
    `saveCustomerFn` real (mesmo endpoint RPC que o app usa, mesma sessão
    autenticada, capturada via `fetch` interceptado e reenviada só com
    `{id, kind, name}` — sem telefone, e-mail, cidade, endereço etc., a
    réplica mais fiel possível de "alguém chamando a função direto, fora do
    formulário") devolveu sucesso e o cliente manteve telefone e e-mail
    intactos no banco — nenhuma linha de auditoria nova (nada mudou de
    verdade, como esperado). `typecheck` + `lint` (0 erros, 5 avisos
    antigos) + `npm test` (477) limpos. Cliente e auditoria de teste
    removidos; empresa 4 voltou a zero cliente e às 13 linhas de auditoria.

    O serviço instalado (NSSM, :8080) só ganha isso depois de atualizado
    (sem migração nova).

    Lacuna nova encontrada: o mesmo buraco em `saveSupplierFn` foi fechado
    no item 69.

69. **`saveSupplierFn` tinha o mesmo buraco do item 68, encontrado ao
    corrigi-lo: chamado sem um campo opcional, apagava esse campo em vez de
    manter o gravado.** `tradeName`/`document`/`email`/`phone`/`whatsapp`/
    `address`/`city`/`state`/`zip`/`representative`/`notes` regravavam
    `data.X ?? null` sempre, sem distinguir "não veio" de "veio vazio" — a
    tela de Fornecedores (`SupplierPanel`, edição) mandava o registro
    inteiro, então o bug nunca aparecia na UI, só numa chamada direta.

    Correção, mesmo padrão do item 68:
    - **`saveSupplierFn`** (`lib/server/party.ts`): validador passa a
      checar `d.X === undefined` antes de sanitizar (preserva "não veio");
      no UPDATE, cada campo é resolvido (`data.X === undefined ? cur.X :
      data.X`) antes de entrar no SQL e na auditoria — `document` continua
      usando `parseCnpj` (equivalente a `parseBrDocument` com `"cnpj"`),
      `state` continua com a mesma ressalva do item 68 (`parseUf` devolve
      `undefined` tanto pra "não veio" quanto pra "veio vazio" — precisa do
      `?? null` extra pra diferenciar).
    - **`SupplierPanel`** (`components/supplier-panel.tsx`): o salvar da
      aba Dados mandava `edit.tradeName || undefined` (e outros 7 campos
      assim) — mesma regressão em potencial do `CustomerPanel` antes do
      item 68. Trocado para mandar o valor puro.
    - **Fornecedores → Novo fornecedor** (`routes/app/fornecedores.tsx`):
      conferido — é só criação (sem `id` no payload), não passa pela
      semântica de "manter o gravado", não precisou de mudança.

    Verificado ao vivo contra o Postgres real (empresa 4) com 1 fornecedor
    descartável "ZZTESTE Partial Supplier" (telefone e e-mail preenchidos),
    mesma metodologia do item 68: (1) limpar o telefone pela aba Dados do
    `SupplierPanel` gravou `phone = null` e manteve o e-mail — confirma que
    a tela continua limpando campo de verdade. (2) Chamada direta ao
    `saveSupplierFn` real (mesmo endpoint RPC, sessão autenticada, request
    capturado via `fetch` interceptado e reenviado só com `{id,
    legalName}` — sem telefone, e-mail, nome fantasia etc.) devolveu
    sucesso e o fornecedor manteve telefone, e-mail e nome fantasia
    intactos no banco. `typecheck` + `lint` (0 erros, 5 avisos antigos) +
    `npm test` (477) limpos. Fornecedor e auditoria de teste removidos;
    empresa 4 voltou a zero fornecedor e às 13 linhas de auditoria.

    O serviço instalado (NSSM, :8080) só ganha isso depois de atualizado
    (sem migração nova).

70. **Meta de vendas não tinha como ser excluída.** Criada com o período, a
    loja ou o vendedor errado (ou um bônus de comissão configurado sem
    querer), ficava presa na tela de Metas para sempre — o único jeito de
    tirar do caminho era editar por cima (ex.: mudar o período pro passado),
    distorcendo o histórico em vez de corrigir o erro. `targets` nem tinha
    coluna `deleted_at` — diferente de customers/products/suppliers, que já
    usam esse padrão.

    Correção:
    - **Migration `0034_target_soft_delete.sql`**: `alter table targets add
      column deleted_at timestamptz` — aditiva, sem default, não quebra
      nada que já lê a tabela.
    - **`deleteTargetFn`** (novo, `lib/server/finance.ts`): soft delete
      (`update targets set deleted_at = now()`), exige `targets.write`,
      audita antes/depois. Sem filho (nada referencia `targets.id`), então
      não precisa do "checa se já foi usada antes de apagar de vez" que
      `commission_rules` precisa — mais simples, mesmo padrão de
      customers/products/suppliers.
    - **`listTargetsFn`**: ganhou `and t.deleted_at is null`.
    - **`saveTargetFn`** (edição): o `select ... for update` que busca a
      meta atual ganhou `and deleted_at is null` — sem isto, editar o id de
      uma meta já excluída a trazia de volta à tela por engano.
    - **Metas** (`routes/app/metas.tsx`): ícone de lixeira ao lado do lápis
      de editar, com um diálogo de confirmação simples (nome da meta +
      aviso de que vendas já contadas continuam no histórico normalmente —
      só o acompanhamento da meta some).

    Verificado ao vivo contra o Postgres real (empresa 4): a migration
    `0034` foi aplicada de verdade (`npm run db:migrate` — igual a um
    deploy real rodaria) e confirmada (`information_schema.columns` mostra
    `targets.deleted_at`); 1 meta descartável "ZZTESTE Meta Deletavel"
    criada pela tela, aparecia no card com progresso 0,0%; clique na
    lixeira abriu "Excluir 'ZZTESTE Meta Deletavel'?"; confirmar gravou
    `deleted_at` no banco, a tela voltou ao estado vazio ("Nenhuma meta
    neste período") e a auditoria registrou `create` e depois `delete` com
    o snapshot certo. `typecheck` + `lint` (0 erros, 5 avisos antigos) +
    `npm test` (477) limpos. Meta de teste apagada de vez (não só soft
    delete, já que era só lixo de teste) e auditoria removida; empresa 4
    voltou a zero meta e às 13 linhas de auditoria.

    **Diferente dos itens anteriores**: este item muda schema, não só
    código — e a migration `0034` já foi aplicada ao banco real do piloto
    nesta sessão (`npm run db:migrate`, igual um deploy rodaria), então
    `targets.deleted_at` já existe lá. O serviço instalado (NSSM, :8080)
    só ganha o código novo (`deleteTargetFn`, o filtro em `listTargetsFn`,
    o botão na tela) quando for atualizado — o banco já está pronto para
    recebê-lo, não falta rodar a migration de novo.

71. **Auditoria não tinha filtro nenhum — só "Carregar mais" por 40 linhas,
    da mais nova pra mais velha, sem jeito de pular direto pra um período ou
    isolar um usuário.** Num piloto que só acumula linha, achar "o que o
    fulano mexeu naquela semana" significava clicar "Carregar mais" repetidas
    vezes rolando por tudo em ordem cronológica.

    Correção:
    - **`listAuditFn`** (`lib/server/session.ts`): ganhou `userId`, `from` e
      `to` opcionais. Cada um checa "não veio" antes de comparar
      (`$X::tipo is null or coluna = $X`), então convive com o cursor de
      paginação por `id` que já existia — trocar o filtro começa uma
      consulta nova (cursor zerado), continuar na mesma página soma mais
      40 do filtro atual.
    - **Auditoria** (`routes/app/configuracoes.tsx`): filtro de usuário (um
      `<select>` com `settings.data.members`, já carregado pela aba
      Usuários — nenhuma consulta nova) e período (dois `<input
      type="date">`, De/Até). "Limpar filtros" só aparece com algum filtro
      ativo. Estado vazio diferencia "nenhuma alteração registrada ainda"
      (cadastro realmente vazio) de "nenhuma alteração para esse filtro"
      (hoje o piloto já cai neste segundo caso com qualquer filtro, porque
      só existe um usuário real).

    **Escopo deliberadamente menor**: sem filtro por tipo de ação
    (criar/alterar/excluir/cancelar/...) nem por entidade (cliente, produto,
    meta...) — os mapas `ACTION`/`ENTITY` já existem em `audit-label.ts` e
    dariam pra virar mais dois `<select>`, mas usuário + período já cobre o
    uso real mais comum ("o que o fulano fez entre essas datas") sem
    transformar a aba numa barra de 4 filtros. Fica documentado para quando
    o piloto tiver mais de um usuário de verdade e a necessidade aparecer.

    Verificado ao vivo contra o Postgres real (empresa 4, as 13 linhas reais
    de auditoria do piloto — sem dado descartável, filtro é leitura): filtro
    "De 28/09" cortou de 13 para 9 linhas (as 4 de 25/09 somem); somando
    "Até 28/09" cortou para 5 (só as de 28/09); selecionar "Victor" no
    filtro de usuário manteve as mesmas 5 (único usuário real do piloto,
    confirma que o filtro não exclui por engano); período sem interseção
    (01/01 a 02/01) mostrou "Nenhuma alteração para esse filtro."; "Limpar
    filtros" devolveu as 13 linhas e o próprio botão sumiu. `typecheck` +
    `lint` (0 erros, 5 avisos antigos) + `npm test` (477) limpos. Nenhum
    dado de teste criado (só filtrou o real) — nada para limpar.

    O serviço instalado (NSSM, :8080) só ganha isso depois de atualizado
    (sem migração nova).

72. **`monthlySalary` (vendedor CLT) não tinha teto, e `birthDate` do
    cliente não era validado.** Lacuna documentada desde o item 56, agora
    fechada. Pontos reais:
    - **`monthlySalary`**: `Math.max(0, Number(data.monthlySalary) || 0)`
      travava negativo e `NaN` (`NaN || 0` vira `0`), mas um valor gigante
      ou digitado a mais (um zero extra: 28000 em vez de 2800) passava
      direto — o número alimenta a base do cálculo de INSS/IRRF da
      comissão do vendedor (CLT), então um erro de digitação aqui distorce
      o líquido de TODA comissão lançada pra aquele vendedor, calado, sem
      aviso nenhum na hora de salvar.
    - **`birthDate`**: `coalesce(${data.birthDate ?? null}, birth_date)`
      gravava qualquer string direto no cast de `date` do Postgres — sem
      validar formato, sem checar se a data existe no calendário, sem
      recusar data no futuro. Hoje nenhuma tela usa o campo (só alcançável
      chamando `saveCustomerFn` direto), mas isso significa que o primeiro
      lugar que expuser o campo herdaria um erro cru do banco em vez de uma
      mensagem decente.

    Correção:
    - **`monthlySalary`** (`lib/server/party.ts`, `saveSellerFn`): troca
      para `requireRange(data.monthlySalary, "Salário mensal", 0,
      999_999_999)` quando o valor vem preenchido — mesmo teto usado em
      `creditLimit` (item 68) e `requireMoney`, só que aqui `0` continua
      válido (vendedor sem regime CLT ou sem salário configurado).
      `data.monthlySalary == null` continua virando `0` sem erro, igual
      antes — só o valor fora da faixa (incluindo `Infinity`, que
      `Math.max(0, Infinity)` deixava passar) passa a ser recusado.
    - **`parseBirthDate`** (nova função local em `party.ts`): data
      AAAA-MM-DD que existe no calendário, ano ≥ 1900, não no futuro. Não
      reaproveita `requireIsoDate` (`lib/sanitize.ts`) porque aquela exige
      ano 2000-2100 — pensada pra data de documento (vencimento, período),
      recusaria o nascimento de qualquer cliente do século passado.
      `saveCustomerFn` passou a chamar essa função quando `birthDate` vem
      preenchido (mesma regra "undefined mantém" dos outros campos opcionais
      — null explícito continua limpando).

    Verificado ao vivo contra o Postgres real (empresa 4): Vendedores → Novo
    vendedor, regime CLT, salário "9999999999" — recusado na tela
    ("Salário mensal deve ficar entre 0 e 999999999."), nada gravado;
    salário "2800" — salvo normalmente (`monthly_salary: "2800.00"`).
    `birthDate` sem tela pra testar: capturado o request real de
    `saveCustomerFn` (criar cliente) e reenviado três vezes com `birthDate`
    adicionado — "not-a-date" recusado ("informe uma data válida"),
    "2099-01-01" recusado ("não pode ser no futuro"), "1990-05-15" aceito e
    gravado certo (`birth_date: "1990-05-15"`); as duas tentativas recusadas
    não criaram cliente nenhum. `typecheck` + `lint` (0 erros, 5 avisos
    antigos) + `npm test` (477) limpos. Vendedor e clientes de teste
    removidos; empresa 4 voltou a zero vendedor/cliente e às 13 linhas de
    auditoria.

    O serviço instalado (NSSM, :8080) só ganha isso depois de atualizado
    (sem migração nova).

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
