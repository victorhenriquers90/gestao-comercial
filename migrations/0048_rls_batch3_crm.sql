-- RLS (P3b), lote 3 de 7: clientes/CRM. Ver HANDOFF.md itens 206-211 pro
-- desenho completo e a licao do lote 1 (nullif desde a primeira
-- tentativa, nao so depois de um incidente).

alter table customers enable row level security;
create policy tenant_isolation on customers
  using (company_id = nullif(current_setting('app.company_id', true), '')::int)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::int);

alter table customer_notes enable row level security;
create policy tenant_isolation on customer_notes
  using (company_id = nullif(current_setting('app.company_id', true), '')::int)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::int);

alter table crm_tasks enable row level security;
create policy tenant_isolation on crm_tasks
  using (company_id = nullif(current_setting('app.company_id', true), '')::int)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::int);
