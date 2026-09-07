-- Covering indexes: Index Only Scan, sem heap fetch (menos I/O no saldo e na ficha).

drop index if exists inventories_variant_idx;
create index if not exists inventories_variant_idx
  on inventories (variant_id, store_id) include (quantity);

drop index if exists sales_customer_idx;
create index if not exists sales_customer_idx
  on sales (customer_id, sold_at desc)
  include (total)
  where deleted_at is null and status = 'finalizada';
