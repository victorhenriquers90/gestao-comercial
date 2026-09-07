-- Gestão Comercial — multi-tenant commercial schema
-- Tenant isolation: every business row carries company_id.
-- Memberships bind Better Auth user_id (text) to a company.

create table if not exists companies (
  id serial primary key,
  name text not null,
  trade_name text,
  document text,
  email text,
  phone text,
  address text,
  city text,
  state text,
  zip text,
  logo_url text,
  seeded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists stores (
  id serial primary key,
  company_id integer not null references companies(id),
  name text not null,
  code text,
  phone text,
  address text,
  city text,
  state text,
  zip text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists stores_company_idx on stores (company_id);

create table if not exists memberships (
  id serial primary key,
  company_id integer not null references companies(id),
  user_id text not null,
  role text not null default 'admin',
  store_id integer references stores(id),
  discount_limit numeric(6,2),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, user_id)
);
create index if not exists memberships_user_idx on memberships (user_id);

create table if not exists pending_invites (
  id serial primary key,
  company_id integer not null references companies(id),
  email text not null,
  role text not null default 'vendedor',
  store_id integer references stores(id),
  invited_by text not null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);
create index if not exists pending_invites_email_idx on pending_invites (lower(email));

create table if not exists company_settings (
  company_id integer primary key references companies(id),
  print_header text,
  print_footer text,
  receipt_message text,
  default_payment_method text default 'dinheiro',
  allow_negative_stock boolean not null default false,
  low_stock_alert boolean not null default true,
  notify_overdue boolean not null default true,
  extra jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists company_counters (
  company_id integer not null references companies(id),
  key text not null,
  value integer not null default 0,
  primary key (company_id, key)
);

create table if not exists categories (
  id serial primary key,
  company_id integer not null references companies(id),
  name text not null,
  parent_id integer references categories(id),
  created_at timestamptz not null default now()
);
create index if not exists categories_company_idx on categories (company_id);

create table if not exists brands (
  id serial primary key,
  company_id integer not null references companies(id),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists suppliers (
  id serial primary key,
  company_id integer not null references companies(id),
  legal_name text not null,
  trade_name text,
  document text,
  email text,
  phone text,
  whatsapp text,
  address text,
  city text,
  state text,
  zip text,
  representative text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists suppliers_company_idx on suppliers (company_id);

create table if not exists products (
  id serial primary key,
  company_id integer not null references companies(id),
  internal_code text,
  barcode text,
  sku text,
  name text not null,
  description text,
  category_id integer references categories(id),
  brand_id integer references brands(id),
  supplier_id integer references suppliers(id),
  unit text not null default 'UN',
  cost numeric(14,4) not null default 0,
  price numeric(14,2) not null default 0,
  promo_price numeric(14,2),
  min_stock numeric(14,3) not null default 0,
  location text,
  image_url text,
  is_active boolean not null default true,
  has_variants boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists products_company_idx on products (company_id);
create index if not exists products_barcode_idx on products (company_id, barcode);
create index if not exists products_name_idx on products (company_id, name);

create table if not exists product_variants (
  id serial primary key,
  company_id integer not null references companies(id),
  product_id integer not null references products(id),
  sku text,
  barcode text,
  color text,
  size text,
  model text,
  cost numeric(14,4),
  price numeric(14,2),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists variants_product_idx on product_variants (product_id);
create index if not exists variants_barcode_idx on product_variants (company_id, barcode);

create table if not exists inventories (
  id serial primary key,
  company_id integer not null references companies(id),
  store_id integer not null references stores(id),
  variant_id integer not null references product_variants(id),
  quantity numeric(14,3) not null default 0,
  min_stock numeric(14,3) not null default 0,
  location text,
  updated_at timestamptz not null default now(),
  unique (store_id, variant_id)
);
create index if not exists inventories_company_idx on inventories (company_id);

create table if not exists stock_movements (
  id serial primary key,
  company_id integer not null references companies(id),
  store_id integer not null references stores(id),
  variant_id integer not null references product_variants(id),
  quantity numeric(14,3) not null,
  previous_qty numeric(14,3) not null,
  new_qty numeric(14,3) not null,
  type text not null,
  user_id text not null,
  note text,
  reference_type text,
  reference_id integer,
  created_at timestamptz not null default now()
);
create index if not exists stock_movements_company_idx on stock_movements (company_id, created_at desc);
create index if not exists stock_movements_variant_idx on stock_movements (variant_id, created_at desc);

create table if not exists customers (
  id serial primary key,
  company_id integer not null references companies(id),
  kind text not null default 'pf',
  name text not null,
  trade_name text,
  document text,
  ie text,
  rg text,
  birth_date date,
  email text,
  phone text,
  whatsapp text,
  address text,
  city text,
  state text,
  zip text,
  credit_limit numeric(14,2) not null default 0,
  notes text,
  crm_stage text not null default 'venda',
  seller_id integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists customers_company_idx on customers (company_id);
create index if not exists customers_doc_idx on customers (company_id, document);

create table if not exists customer_notes (
  id serial primary key,
  company_id integer not null references companies(id),
  customer_id integer not null references customers(id),
  user_id text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists crm_tasks (
  id serial primary key,
  company_id integer not null references companies(id),
  customer_id integer not null references customers(id),
  user_id text not null,
  title text not null,
  due_at timestamptz,
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists crm_tasks_company_idx on crm_tasks (company_id);

create table if not exists sellers (
  id serial primary key,
  company_id integer not null references companies(id),
  user_id text,
  name text not null,
  email text,
  phone text,
  commission_pct numeric(6,2) not null default 5,
  is_active boolean not null default true,
  store_id integer references stores(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists sellers_company_idx on sellers (company_id);

alter table customers add constraint customers_seller_fk
  foreign key (seller_id) references sellers(id);

create table if not exists commission_rules (
  id serial primary key,
  company_id integer not null references companies(id),
  seller_id integer references sellers(id),
  kind text not null default 'percent_sales',
  category_id integer references categories(id),
  product_id integer references products(id),
  percent numeric(6,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists commissions (
  id serial primary key,
  company_id integer not null references companies(id),
  seller_id integer not null references sellers(id),
  sale_id integer,
  amount numeric(14,2) not null,
  percent numeric(6,2) not null,
  status text not null default 'pendente',
  created_at timestamptz not null default now()
);

create table if not exists cash_accounts (
  id serial primary key,
  company_id integer not null references companies(id),
  store_id integer references stores(id),
  name text not null,
  kind text not null,
  opening_balance numeric(14,2) not null default 0,
  is_active boolean not null default true
);

create table if not exists cash_registers (
  id serial primary key,
  company_id integer not null references companies(id),
  store_id integer not null references stores(id),
  user_id text not null,
  opened_at timestamptz not null default now(),
  opening_amount numeric(14,2) not null default 0,
  closed_at timestamptz,
  closing_amount numeric(14,2),
  expected_amount numeric(14,2),
  difference_amount numeric(14,2),
  notes text,
  status text not null default 'open'
);
create index if not exists cash_registers_store_idx on cash_registers (store_id, status);

create table if not exists cash_movements (
  id serial primary key,
  company_id integer not null references companies(id),
  store_id integer not null references stores(id),
  register_id integer references cash_registers(id),
  user_id text not null,
  type text not null,
  method text,
  amount numeric(14,2) not null,
  description text,
  sale_id integer,
  created_at timestamptz not null default now()
);
create index if not exists cash_movements_register_idx on cash_movements (register_id);

create table if not exists sales (
  id serial primary key,
  company_id integer not null references companies(id),
  store_id integer not null references stores(id),
  number integer not null,
  customer_id integer references customers(id),
  seller_id integer references sellers(id),
  user_id text not null,
  status text not null default 'finalizada',
  notes text,
  subtotal numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  cost_total numeric(14,2) not null default 0,
  sold_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists sales_company_idx on sales (company_id, sold_at desc);
create index if not exists sales_store_idx on sales (store_id, sold_at desc);
create unique index if not exists sales_number_idx on sales (company_id, number);

create table if not exists sale_items (
  id serial primary key,
  company_id integer not null references companies(id),
  sale_id integer not null references sales(id),
  variant_id integer not null references product_variants(id),
  product_id integer not null references products(id),
  description text not null,
  quantity numeric(14,3) not null,
  unit_price numeric(14,2) not null,
  discount numeric(14,2) not null default 0,
  total numeric(14,2) not null,
  cost numeric(14,4) not null default 0
);
create index if not exists sale_items_sale_idx on sale_items (sale_id);

create table if not exists payments (
  id serial primary key,
  company_id integer not null references companies(id),
  sale_id integer not null references sales(id),
  method text not null,
  amount numeric(14,2) not null,
  received numeric(14,2),
  change_amount numeric(14,2),
  installments integer not null default 1,
  brand text,
  created_at timestamptz not null default now()
);
create index if not exists payments_sale_idx on payments (sale_id);

create table if not exists returns (
  id serial primary key,
  company_id integer not null references companies(id),
  store_id integer not null references stores(id),
  sale_id integer not null references sales(id),
  user_id text not null,
  kind text not null default 'total',
  reason text not null,
  total numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists return_items (
  id serial primary key,
  company_id integer not null references companies(id),
  return_id integer not null references returns(id),
  sale_item_id integer not null references sale_items(id),
  variant_id integer not null references product_variants(id),
  quantity numeric(14,3) not null,
  amount numeric(14,2) not null
);

create table if not exists purchases (
  id serial primary key,
  company_id integer not null references companies(id),
  store_id integer not null references stores(id),
  supplier_id integer references suppliers(id),
  number integer not null,
  status text not null default 'orcamento',
  notes text,
  subtotal numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0,
  freight numeric(14,2) not null default 0,
  tax numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  expected_at date,
  received_at timestamptz,
  user_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists purchases_company_idx on purchases (company_id, created_at desc);

create table if not exists purchase_items (
  id serial primary key,
  company_id integer not null references companies(id),
  purchase_id integer not null references purchases(id),
  variant_id integer not null references product_variants(id),
  product_id integer not null references products(id),
  description text not null,
  quantity numeric(14,3) not null,
  unit_cost numeric(14,4) not null,
  discount numeric(14,2) not null default 0,
  total numeric(14,2) not null
);

create table if not exists accounts_payable (
  id serial primary key,
  company_id integer not null references companies(id),
  store_id integer references stores(id),
  supplier_id integer references suppliers(id),
  purchase_id integer references purchases(id),
  description text not null,
  category text,
  due_date date not null,
  amount numeric(14,2) not null,
  paid_amount numeric(14,2) not null default 0,
  interest numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0,
  paid_at timestamptz,
  status text not null default 'pendente',
  user_id text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists ap_company_idx on accounts_payable (company_id, due_date);

create table if not exists accounts_receivable (
  id serial primary key,
  company_id integer not null references companies(id),
  store_id integer references stores(id),
  customer_id integer references customers(id),
  sale_id integer references sales(id),
  description text not null,
  due_date date not null,
  amount numeric(14,2) not null,
  received_amount numeric(14,2) not null default 0,
  interest numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0,
  received_at timestamptz,
  status text not null default 'pendente',
  user_id text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists ar_company_idx on accounts_receivable (company_id, due_date);

create table if not exists targets (
  id serial primary key,
  company_id integer not null references companies(id),
  store_id integer references stores(id),
  seller_id integer references sellers(id),
  category_id integer references categories(id),
  product_id integer references products(id),
  name text not null,
  period_start date not null,
  period_end date not null,
  amount numeric(14,2) not null,
  created_at timestamptz not null default now()
);
create index if not exists targets_company_idx on targets (company_id);

create table if not exists promotions (
  id serial primary key,
  company_id integer not null references companies(id),
  name text not null,
  kind text not null,
  percent numeric(6,2),
  amount numeric(14,2),
  promo_price numeric(14,2),
  buy_qty numeric(14,3),
  pay_qty numeric(14,3),
  min_qty numeric(14,3),
  product_id integer references products(id),
  category_id integer references categories(id),
  starts_at date not null,
  ends_at date not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists notifications (
  id serial primary key,
  company_id integer not null references companies(id),
  user_id text,
  kind text not null,
  title text not null,
  body text,
  href text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_company_idx on notifications (company_id, created_at desc);

create table if not exists audit_logs (
  id serial primary key,
  company_id integer not null references companies(id),
  user_id text not null,
  action text not null,
  entity text not null,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_company_idx on audit_logs (company_id, created_at desc);

create table if not exists expenses (
  id serial primary key,
  company_id integer not null references companies(id),
  store_id integer references stores(id),
  description text not null,
  category text,
  amount numeric(14,2) not null,
  spent_at date not null,
  account_kind text,
  user_id text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
