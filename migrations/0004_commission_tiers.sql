-- Volume tiers (faixas) on rules, and per-item commission breakdown on payouts.

alter table commission_rules
  add column if not exists tiers jsonb not null default '[]'::jsonb,
  add column if not exists tier_basis text not null default 'none';

alter table commissions
  add column if not exists breakdown jsonb not null default '[]'::jsonb;
