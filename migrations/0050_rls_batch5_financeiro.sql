-- RLS (P3b), lote 5 de 7: financeiro. Ver HANDOFF.md itens 206-213 pro
-- desenho completo e a licao do lote 1 (nullif desde a primeira
-- tentativa, nao so depois de um incidente).

alter table accounts_payable enable row level security;
create policy tenant_isolation on accounts_payable
  using (company_id = nullif(current_setting('app.company_id', true), '')::int)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::int);

alter table accounts_receivable enable row level security;
create policy tenant_isolation on accounts_receivable
  using (company_id = nullif(current_setting('app.company_id', true), '')::int)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::int);

alter table cash_registers enable row level security;
create policy tenant_isolation on cash_registers
  using (company_id = nullif(current_setting('app.company_id', true), '')::int)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::int);

alter table cash_movements enable row level security;
create policy tenant_isolation on cash_movements
  using (company_id = nullif(current_setting('app.company_id', true), '')::int)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::int);

alter table expenses enable row level security;
create policy tenant_isolation on expenses
  using (company_id = nullif(current_setting('app.company_id', true), '')::int)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::int);
