-- Reativa RLS no lote 1 (revertida no item 0042 por um erro em producao
-- que nao foi possivel reproduzir nem com o teste mais fiel possivel --
-- SSR local real, app_rw real, mesma branch com dado copiado de producao.
-- Ver HANDOFF.md itens 207/208 pro investigativo completo.
--
-- As policies de 0041 nunca foram apagadas (0042 so desativou o
-- enforcement) -- so precisa reativar, nao recriar `create policy`.

alter table stores enable row level security;
alter table categories enable row level security;
alter table brands enable row level security;
alter table suppliers enable row level security;
alter table sellers enable row level security;
alter table company_settings enable row level security;
alter table company_counters enable row level security;
alter table commission_rules enable row level security;
alter table cash_accounts enable row level security;
alter table card_rates enable row level security;
