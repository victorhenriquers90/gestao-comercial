-- Commission rules: named policies, payment/promo filters, and notes on payouts.

alter table commission_rules
  add column if not exists name text not null default '',
  add column if not exists is_active boolean not null default true,
  add column if not exists payment_method text,
  add column if not exists min_amount numeric(14,2) not null default 0,
  add column if not exists skip_promo boolean not null default false,
  add column if not exists only_promo boolean not null default false,
  add column if not exists priority integer not null default 0,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists commission_rules_company_idx on commission_rules (company_id);

alter table commissions
  add column if not exists rule_id integer references commission_rules(id),
  add column if not exists note text;
