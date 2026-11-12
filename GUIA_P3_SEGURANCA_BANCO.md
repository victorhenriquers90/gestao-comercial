# Guia P3 — Segurança de acesso ao banco (auditoria de DBA, itens 184/187)

Dois upgrades estruturais recomendados pela auditoria. O **P3a é barato e
vale fazer já**; o **P3b é um projeto próprio**, descrito aqui só para a
decisão ficar informada. Nenhum dos dois foi executado — os passos abaixo
dependem de você (painéis do Neon e do Vercel, onde vivem as credenciais).

---

## P3a — Role só-DML para o runtime (app deixa de rodar como dona do banco)

**Problema**: hoje o app em produção conecta como `neondb_owner`
(CREATEDB, CREATEROLE, BYPASSRLS). A auditoria não achou injeção de SQL,
mas se um dia houver uma — ou um pacote npm comprometido — o invasor tem
controle TOTAL do banco, incluindo `DROP TABLE`. Com uma role que só faz
SELECT/INSERT/UPDATE/DELETE, o pior caso encolhe muito.

**O código já está pronto**: `scripts/migrate.mjs` agora usa
`MIGRATE_DATABASE_URL` se ela existir, senão `DATABASE_URL` — ou seja,
nada muda até você criar as variáveis; quando criar, as migrations
continuam com a role dona e o app passa pra role limitada.

### Passo 1 — Criar a role no Neon (você)

Console do Neon → projeto do gestao-comercial → **Roles** → **New Role**
→ nome `app_runtime`. O Neon gera a senha e mostra a connection string
dessa role — guarde-a, é a futura `DATABASE_URL`.

> Prefira o console ao SQL para criar a role: o Neon gerencia a senha e
> monta a string certa (host `-pooler`, `sslmode`) sozinho.

### Passo 2 — Conceder DML (você, no SQL Editor do Neon, conectado como `neondb_owner` no banco `neondb`)

```sql
grant connect on database neondb to app_runtime;
grant usage on schema public to app_runtime;
grant select, insert, update, delete on all tables in schema public to app_runtime;
grant usage, select on all sequences in schema public to app_runtime;

-- Tabelas FUTURAS (migrations rodam como neondb_owner): sem estas duas
-- linhas, cada migration nova criaria tabela/sequence que o runtime não
-- enxerga e o app quebraria depois do deploy seguinte.
alter default privileges for role neondb_owner in schema public
  grant select, insert, update, delete on tables to app_runtime;
alter default privileges for role neondb_owner in schema public
  grant usage, select on sequences to app_runtime;
```

Conferência rápida (ainda no SQL Editor):

```sql
select rolname, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls
from pg_roles where rolname = 'app_runtime';
-- esperado: tudo false
```

### Passo 3 — Trocar as variáveis no Vercel (você)

Projeto gestao-comercial → **Settings → Environment Variables**
(Production), marcando as duas como **Sensitive**, como a atual:

| Variável | Valor |
|---|---|
| `MIGRATE_DATABASE_URL` | a string ATUAL (de `neondb_owner`) — copie antes de mexer |
| `DATABASE_URL` | a string nova da role `app_runtime` (passo 1) |

> **Ordem importa**: crie `MIGRATE_DATABASE_URL` primeiro. Como a atual é
> Sensitive (ilegível depois de salva), se você sobrescrever
> `DATABASE_URL` antes de copiar o valor, a string da dona se perde — aí
> seria pegá-la de novo no painel do Neon.

### Passo 4 — Redeploy e verificação

Qualquer push (ou "Redeploy" no painel) aplica. Verificar:

1. O log de build mostra `[migrate] up to date.` (ou `applied …`) — prova
   que a rota de migration (role dona) funciona.
2. O app abre e opera normalmente (PDV, vendas, caixa) — prova que a role
   `app_runtime` cobre o dia a dia.
3. Se algo falhar com "permission denied", é um GRANT faltando — reverter
   é só apontar `DATABASE_URL` de volta pra string da dona.

**Aproveite e confira o P4 no mesmo passo**: o host da string deve conter
`-pooler` (endpoint com pooling do Neon). Sem isso, picos de instâncias
serverless do Vercel podem esgotar as conexões diretas.

---

## P3b — RLS (Row-Level Security) como cinto de segurança multi-tenant

**Problema**: o isolamento entre empresas é 100% aplicação (todo `where
company_id = $1` é escrito à mão; a auditoria mediu zero vazamento HOJE).
O risco é o futuro: um único `where` esquecido numa query nova vaza dado
de um cliente pra outro, em silêncio. RLS faz o PRÓPRIO banco recusar
linhas de outra empresa, mesmo que a query esqueça o filtro.

**Por que não é um passo deste guia**: é um projeto de verdade —

1. Política em ~40 tabelas (`using (company_id =
   current_setting('app.company_id')::int)`), com atenção às tabelas sem
   `company_id` direto (ex.: as do Better Auth ficam fora).
2. O app precisa passar a empresa pro banco por requisição: hoje cada
   query pega uma conexão qualquer do pool, então seria preciso envolver
   as leituras em transação com `set local app.company_id = …` (o
   `requireTenant`/`getSql` centralizam isso, mas é mudança no caminho de
   TODA query, com teste de regressão pesado).
3. Só vale com o P3a feito antes: `neondb_owner` tem BYPASSRLS — política
   nenhuma se aplica a ela. RLS sem a role limitada é decoração.

**Recomendação**: P3a agora; P3b entra como fase planejada (com plano
próprio e testes) quando houver mais de um cliente pagante de verdade no
banco — antes disso o custo/benefício não fecha.
