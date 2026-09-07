create table if not exists held_sales (
  id serial primary key,
  company_id integer not null references companies(id),
  store_id integer not null references stores(id),
  user_id text not null,
  customer_id integer references customers(id),
  seller_id integer references sellers(id),
  notes text,
  discount numeric(14,2) not null default 0,
  payload text not null,
  created_at timestamptz not null default now()
);
create index if not exists held_sales_store_idx on held_sales (company_id, store_id, created_at desc);
