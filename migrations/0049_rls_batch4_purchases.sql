-- RLS (P3b), lote 4 de 7: compras. Ver HANDOFF.md itens 206-212 pro
-- desenho completo e a licao do lote 1 (nullif desde a primeira
-- tentativa, nao so depois de um incidente).

alter table purchases enable row level security;
create policy tenant_isolation on purchases
  using (company_id = nullif(current_setting('app.company_id', true), '')::int)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::int);

alter table purchase_items enable row level security;
create policy tenant_isolation on purchase_items
  using (company_id = nullif(current_setting('app.company_id', true), '')::int)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::int);
