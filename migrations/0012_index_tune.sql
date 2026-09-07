-- Indexes the remaining hot filters can actually use (CRM, comissão, PDV ativo).

create index if not exists sales_customer_idx
  on sales (customer_id, sold_at desc)
  where deleted_at is null and status = 'finalizada';

create index if not exists ar_customer_idx
  on accounts_receivable (customer_id)
  where deleted_at is null;

create index if not exists crm_tasks_open_idx
  on crm_tasks (customer_id)
  where done_at is null;

create index if not exists customers_name_idx on customers (company_id, name);
create index if not exists customers_phone_idx on customers (company_id, phone);

create index if not exists commissions_pending_idx
  on commissions (company_id, seller_id)
  where status = 'pendente';

create index if not exists commissions_paid_idx
  on commissions (company_id, paid_at)
  where status = 'pago';

create index if not exists products_active_idx
  on products (company_id)
  where deleted_at is null and is_active = true;

create index if not exists variants_active_idx
  on product_variants (company_id)
  where deleted_at is null and is_active = true;

create index if not exists promotions_live_idx
  on promotions (company_id, starts_at, ends_at)
  where is_active = true;

create index if not exists purchases_store_idx
  on purchases (company_id, store_id, created_at desc);
