-- Razao das baixas de contas a pagar / a receber.
--
-- paid_amount/received_amount sao CUMULATIVOS na linha do titulo: nada dizia
-- quais baixas o formaram, qual forma de pagamento cada uma usou nem qual
-- movimentacao de caixa ela gerou. Para poder ESTORNAR a ultima baixa (pagou o
-- fornecedor errado, recebeu do cliente errado, digitou o valor errado) sem
-- adivinhar, cada baixa passa a deixar uma linha aqui.
--
-- Baixas anteriores a esta migracao nao tem linha: o estorno delas e recusado
-- (o sistema nao sabe se foi em dinheiro nem qual caixa).
--
-- `reversed_*` marca o estorno em vez de apagar a linha: a baixa original e o
-- seu desfazimento ficam os dois visiveis. `prev_interest`/`prev_discount`
-- guardam os juros e o desconto de ANTES da baixa para o estorno restaura-los.

create table if not exists account_settlements (
  id serial primary key,
  company_id integer not null references companies(id),
  kind text not null check (kind in ('payable', 'receivable')),
  account_id integer not null,
  amount numeric(14,2) not null check (amount > 0),
  interest numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0,
  prev_interest numeric(14,2) not null default 0,
  prev_discount numeric(14,2) not null default 0,
  method text not null,
  cash_movement_id integer references cash_movements(id),
  user_id text not null,
  created_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversed_by text,
  reverse_reason text,
  reverse_movement_id integer references cash_movements(id)
);

create index if not exists account_settlements_account_idx
  on account_settlements (company_id, kind, account_id, id);
