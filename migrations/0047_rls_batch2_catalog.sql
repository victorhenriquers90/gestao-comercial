-- RLS (P3b), lote 2 de 7: catalogo/estoque. Ver HANDOFF.md itens 206-210
-- pro desenho completo e a licao do lote 1 (usar nullif desde o inicio,
-- nao so depois de um incidente -- current_setting(...)::int puro quebra
-- com erro, nao so nega, se a GUC vier como string vazia sob concorrencia
-- real de producao).

alter table products enable row level security;
create policy tenant_isolation on products
  using (company_id = nullif(current_setting('app.company_id', true), '')::int)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::int);

alter table product_variants enable row level security;
create policy tenant_isolation on product_variants
  using (company_id = nullif(current_setting('app.company_id', true), '')::int)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::int);

alter table inventories enable row level security;
create policy tenant_isolation on inventories
  using (company_id = nullif(current_setting('app.company_id', true), '')::int)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::int);

alter table stock_movements enable row level security;
create policy tenant_isolation on stock_movements
  using (company_id = nullif(current_setting('app.company_id', true), '')::int)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::int);

alter table stock_counts enable row level security;
create policy tenant_isolation on stock_counts
  using (company_id = nullif(current_setting('app.company_id', true), '')::int)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::int);

alter table stock_count_items enable row level security;
create policy tenant_isolation on stock_count_items
  using (company_id = nullif(current_setting('app.company_id', true), '')::int)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::int);
