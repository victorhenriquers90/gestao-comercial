-- RLS (P3b), lote 6 de 7: comissao/metas/ops. Ver HANDOFF.md itens
-- 206-214 pro desenho completo e a licao do lote 1 (nullif desde a
-- primeira tentativa, nao so depois de um incidente).

alter table commissions enable row level security;
create policy tenant_isolation on commissions
  using (company_id = nullif(current_setting('app.company_id', true), '')::int)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::int);

alter table targets enable row level security;
create policy tenant_isolation on targets
  using (company_id = nullif(current_setting('app.company_id', true), '')::int)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::int);

alter table promotions enable row level security;
create policy tenant_isolation on promotions
  using (company_id = nullif(current_setting('app.company_id', true), '')::int)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::int);

alter table notifications enable row level security;
create policy tenant_isolation on notifications
  using (company_id = nullif(current_setting('app.company_id', true), '')::int)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::int);

alter table audit_logs enable row level security;
create policy tenant_isolation on audit_logs
  using (company_id = nullif(current_setting('app.company_id', true), '')::int)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::int);
