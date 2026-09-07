# Gestão Comercial

Plataforma de gestão para loja: PDV, estoque, compras, financeiro, comissões
(com retenções 2026) e CRM. Interface em português, pensada para **desktop**.

## Para outras IAs

Abra **[HANDOFF.md](HANDOFF.md)** (mapa, invariantes, o que não refazer) e
**[AGENTS.project.md](AGENTS.project.md)** (regras curtas).  
`CLAUDE.md` aponta para os mesmos arquivos.

O `AGENTS.md` da raiz é o contrato do **sandbox Grok App Builder**. Fora desse
ambiente, ignore a parte de preview/8080 e siga o HANDOFF.

## Stack

TanStack Start · React 19 · Tailwind v4 · Better Auth (e-mail/senha) ·
Postgres (Neon ou PGLite embutido).

## Desenvolvimento

```bash
npm install
npm run dev
npm run typecheck
npm run test
```

- Sem `DATABASE_URL`: PGLite (Postgres em WASM), demo na primeira conta.
- Com `DATABASE_URL`: Postgres/Neon; rode `npm run db:migrate`.

Variáveis úteis: `VITE_AUTH_ENABLED`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
`DATABASE_URL`. O wrapper `scripts/with-app-env.mjs` mescla `.grok/app-env.json`.

## Módulos

PDV (F2–F10) · Vendas · Produtos/grades · Estoque · Compras · Clientes/CRM ·
Fornecedores · Financeiro · Caixa · Vendedores/comissões · Metas · Promoções ·
Devoluções · Relatórios · Configurações.

Documento na nota (CPF/CNPJ, módulo 11). Código de barras GTIN. Um caixa
aberto por loja.
