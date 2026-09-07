-- Integrity the checkout already enforces, now also in Postgres.
-- Partial unique: one open register per store (race-safe).
-- CHECKs: quantities and money cannot go negative / zero on documents.

create unique index if not exists cash_registers_one_open_idx
  on cash_registers (store_id)
  where status = 'open';

do $$ begin
  alter table sale_items add constraint sale_items_qty_positive check (quantity > 0);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table purchase_items add constraint purchase_items_qty_positive check (quantity > 0);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table return_items add constraint return_items_qty_positive check (quantity > 0);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table payments add constraint payments_amount_positive check (amount > 0);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table sales add constraint sales_money_nonneg check (
    subtotal >= 0 and discount >= 0 and total >= 0 and cost_total >= 0
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table cash_registers add constraint cash_registers_opening_nonneg check (opening_amount >= 0);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table commissions add constraint commissions_amount_nonneg check (amount >= 0);
exception when duplicate_object then null;
end $$;
