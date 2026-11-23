-- RLS (P3b), lote 1 de 7: tabelas de referencia/config, menor risco pra
-- validar o mecanismo em producao antes dos lotes mais quentes. Ver plano
-- completo em HANDOFF.md (item 205) e GUIA_P3_SEGURANCA_BANCO.md.
--
-- Sem FORCE ROW LEVEL SECURITY: o dono da tabela (neondb_owner) so roda
-- DDL (migrations), nunca DML -- deixar RLS-isento pra ele e o padrao e e
-- o certo aqui. `app_rw` (role de runtime, ver HANDOFF item 204) nao e
-- dono nem superusuario, entao a policy se aplica a ela automaticamente.
--
-- current_setting('app.company_id', true) com o 2o parametro true nunca
-- lanca erro se a GUC nao estiver definida -- devolve NULL, e
-- `company_id = NULL` e sempre falso: nega por padrao, nao quebra.
--
-- `memberships` e `pending_invites` ficam de FORA de proposito (nao
-- entram em nenhum lote, nunca) -- ver item 205 do HANDOFF pro motivo
-- (chicken-and-egg: e por `memberships`/token que o sistema descobre o
-- company_id antes de ter uma GUC pra exigir).

alter table stores enable row level security;
create policy tenant_isolation on stores
  using (company_id = current_setting('app.company_id', true)::int)
  with check (company_id = current_setting('app.company_id', true)::int);

alter table categories enable row level security;
create policy tenant_isolation on categories
  using (company_id = current_setting('app.company_id', true)::int)
  with check (company_id = current_setting('app.company_id', true)::int);

alter table brands enable row level security;
create policy tenant_isolation on brands
  using (company_id = current_setting('app.company_id', true)::int)
  with check (company_id = current_setting('app.company_id', true)::int);

alter table suppliers enable row level security;
create policy tenant_isolation on suppliers
  using (company_id = current_setting('app.company_id', true)::int)
  with check (company_id = current_setting('app.company_id', true)::int);

alter table sellers enable row level security;
create policy tenant_isolation on sellers
  using (company_id = current_setting('app.company_id', true)::int)
  with check (company_id = current_setting('app.company_id', true)::int);

alter table company_settings enable row level security;
create policy tenant_isolation on company_settings
  using (company_id = current_setting('app.company_id', true)::int)
  with check (company_id = current_setting('app.company_id', true)::int);

alter table company_counters enable row level security;
create policy tenant_isolation on company_counters
  using (company_id = current_setting('app.company_id', true)::int)
  with check (company_id = current_setting('app.company_id', true)::int);

alter table commission_rules enable row level security;
create policy tenant_isolation on commission_rules
  using (company_id = current_setting('app.company_id', true)::int)
  with check (company_id = current_setting('app.company_id', true)::int);

alter table cash_accounts enable row level security;
create policy tenant_isolation on cash_accounts
  using (company_id = current_setting('app.company_id', true)::int)
  with check (company_id = current_setting('app.company_id', true)::int);

alter table card_rates enable row level security;
create policy tenant_isolation on card_rates
  using (company_id = current_setting('app.company_id', true)::int)
  with check (company_id = current_setting('app.company_id', true)::int);
