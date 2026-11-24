-- Reforco defensivo nas 10 policies do lote 1, antes da proxima tentativa
-- de reativar RLS (ver HANDOFF item 209): current_setting(..., true)::int
-- quebra com erro se a GUC vier como string VAZIA em vez de NULL -- em vez
-- de so negar acesso, que ja e o comportamento esperado pro caso NULL.
-- nullif(..., '') converte string vazia em NULL antes do cast: nunca mais
-- erro, so nega. Nao resolve a causa raiz da corrida (ainda desconhecida),
-- fecha a classe do sintoma (erro 500 visivel pro usuario).
--
-- drop + create porque Postgres nao tem "alter policy ... using (...)"
-- direto nesse formato -- precisa recriar.

drop policy if exists tenant_isolation on stores;
create policy tenant_isolation on stores
  using (company_id = nullif(current_setting('app.company_id', true), '')::int)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::int);

drop policy if exists tenant_isolation on categories;
create policy tenant_isolation on categories
  using (company_id = nullif(current_setting('app.company_id', true), '')::int)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::int);

drop policy if exists tenant_isolation on brands;
create policy tenant_isolation on brands
  using (company_id = nullif(current_setting('app.company_id', true), '')::int)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::int);

drop policy if exists tenant_isolation on suppliers;
create policy tenant_isolation on suppliers
  using (company_id = nullif(current_setting('app.company_id', true), '')::int)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::int);

drop policy if exists tenant_isolation on sellers;
create policy tenant_isolation on sellers
  using (company_id = nullif(current_setting('app.company_id', true), '')::int)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::int);

drop policy if exists tenant_isolation on company_settings;
create policy tenant_isolation on company_settings
  using (company_id = nullif(current_setting('app.company_id', true), '')::int)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::int);

drop policy if exists tenant_isolation on company_counters;
create policy tenant_isolation on company_counters
  using (company_id = nullif(current_setting('app.company_id', true), '')::int)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::int);

drop policy if exists tenant_isolation on commission_rules;
create policy tenant_isolation on commission_rules
  using (company_id = nullif(current_setting('app.company_id', true), '')::int)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::int);

drop policy if exists tenant_isolation on cash_accounts;
create policy tenant_isolation on cash_accounts
  using (company_id = nullif(current_setting('app.company_id', true), '')::int)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::int);

drop policy if exists tenant_isolation on card_rates;
create policy tenant_isolation on card_rates
  using (company_id = nullif(current_setting('app.company_id', true), '')::int)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::int);
