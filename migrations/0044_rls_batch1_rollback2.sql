-- Segunda reversao do lote 1 de RLS: reproduziu de novo em producao
-- (segunda recarga de /app/fornecedores, nao a primeira) -- confirma que
-- e uma condicao de corrida ligada a concorrencia real do servidor, nao
-- um bug deterministico (por isso nao reproduziu localmente nem na
-- branch de teste, onde a concorrencia e outra). Ver HANDOFF item 209.

alter table stores disable row level security;
alter table categories disable row level security;
alter table brands disable row level security;
alter table suppliers disable row level security;
alter table sellers disable row level security;
alter table company_settings disable row level security;
alter table company_counters disable row level security;
alter table commission_rules disable row level security;
alter table cash_accounts disable row level security;
alter table card_rates disable row level security;
