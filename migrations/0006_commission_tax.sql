-- Net commission: tax regime per seller, withholdings on payouts, company ISS default.

alter table sellers
  add column if not exists tax_regime text not null default 'none',
  add column if not exists monthly_salary numeric(14,2) not null default 0,
  add column if not exists dependents integer not null default 0,
  add column if not exists iss_rate numeric(6,2);

alter table commissions
  add column if not exists net_amount numeric(14,2),
  add column if not exists tax_inss numeric(14,2) not null default 0,
  add column if not exists tax_irrf numeric(14,2) not null default 0,
  add column if not exists tax_iss numeric(14,2) not null default 0,
  add column if not exists tax_other numeric(14,2) not null default 0,
  add column if not exists tax_breakdown jsonb not null default '{}'::jsonb;

alter table company_settings
  add column if not exists iss_rate numeric(6,2) not null default 5,
  add column if not exists iss_withhold boolean not null default true;
