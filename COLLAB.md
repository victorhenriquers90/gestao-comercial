# Como várias IAs trabalham neste repo

IAs não compartilham memória. A mesa é o **Git**. Cada uma lê
[HANDOFF.md](HANDOFF.md) e [AGENTS.project.md](AGENTS.project.md).

## Prompt de abertura (cole no começo de cada sessão)

```text
Continue o ERP Gestão Comercial (TanStack Start, pt-BR, desktop).
Leia HANDOFF.md, AGENTS.project.md e COLLAB.md.
Não quebre company_id, caixa aberto no checkout, CPF/CNPJ/EAN,
nem religue Google/X. Tarefa desta sessão: <uma coisa só>.
```

## Regras

1. Uma IA, uma branch, uma fatia (`feat/…`, `fix/…`). Nunca duas no `main`.
2. Não editar os mesmos arquivos em paralelo. Auth, `requireTenant`,
   `document.ts`, `check-digit.ts` e migrations = uma IA só.
3. Depois de TS: `npm run typecheck` e `npm run test`.
4. Commit pequeno. PR. Outra IA revisa o **diff** (IDOR / `company_id`), não o chat.
5. UI em pt-BR. Desktop-first. Sem NFC-e sem pedido explícito.

## Partição sugerida

| Área | Arquivos |
|---|---|
| PDV / F4 | `src/routes/app/pdv.tsx`, `src/lib/server/commerce.ts` |
| Catálogo | `src/lib/server/catalog.ts`, `src/routes/app/produtos.tsx` |
| Pessoas | `src/lib/server/party.ts`, clientes / vendedores |
| Folha | `src/lib/commission.ts`, `src/lib/tax.ts` |
| Auth | `src/lib/auth/*` — não misturar com PDV |

## Setup

```bash
npm install
npm run dev
```

Sem `DATABASE_URL` usa PGLite. Copiar o repo **sem** `node_modules`.
O `AGENTS.md` da raiz é o sandbox Grok; fora dele, siga este arquivo + HANDOFF.
