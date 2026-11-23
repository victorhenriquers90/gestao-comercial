-- Rollback de emergencia do lote 1 de RLS (migration 0041): producao
-- mostrou "invalid input syntax for type integer: ''" na pagina de
-- Fornecedores logo apos o deploy, nao reproduzido nos testes locais nem
-- na branch descartavel -- investigar a causa com calma antes de tentar
-- de novo (ver HANDOFF item 207). Desativa a RLS, mantem as policies
-- definidas (CREATE POLICY nao e desfeito, so o enforcement).

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
