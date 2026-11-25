-- RLS (P3b), lote 7 de 7, o ultimo e mais quente: vendas. Ver HANDOFF.md
-- itens 206-215 pro desenho completo e a licao do lote 1 (nullif desde a
-- primeira tentativa, nao so depois de um incidente).
--
-- `enable row level security` so pega lock ACCESS EXCLUSIVE para alterar
-- metadado da tabela (nao reescreve linha nenhuma) -- e rapido mesmo em
-- tabela quente, mas estas sao as mais acessadas do sistema (PDV), entao
-- esta e a ultima migration do rollout por design.

alter table sales enable row level security;
create policy tenant_isolation on sales
  using (company_id = nullif(current_setting('app.company_id', true), '')::int)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::int);

alter table sale_items enable row level security;
create policy tenant_isolation on sale_items
  using (company_id = nullif(current_setting('app.company_id', true), '')::int)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::int);

alter table payments enable row level security;
create policy tenant_isolation on payments
  using (company_id = nullif(current_setting('app.company_id', true), '')::int)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::int);

alter table returns enable row level security;
create policy tenant_isolation on returns
  using (company_id = nullif(current_setting('app.company_id', true), '')::int)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::int);

alter table return_items enable row level security;
create policy tenant_isolation on return_items
  using (company_id = nullif(current_setting('app.company_id', true), '')::int)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::int);

alter table held_sales enable row level security;
create policy tenant_isolation on held_sales
  using (company_id = nullif(current_setting('app.company_id', true), '')::int)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::int);

alter table account_settlements enable row level security;
create policy tenant_isolation on account_settlements
  using (company_id = nullif(current_setting('app.company_id', true), '')::int)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::int);
