-- Terceira tentativa de reativar RLS no lote 1, depois do reforco
-- defensivo nas policies (0045: nullif(current_setting(...), '')::int).
-- Ver HANDOFF item 209.

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
