-- Commission bonus attached to sales targets (meta do vendedor).

alter table targets
  add column if not exists bonus_kind text not null default 'none',
  add column if not exists bonus_value numeric(14,2) not null default 0;
