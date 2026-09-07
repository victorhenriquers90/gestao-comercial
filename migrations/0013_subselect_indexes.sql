-- Subselects / lookups that do not lead with the existing unique prefix.
-- inventories unique is (store_id, variant_id); "stock of this SKU" filters variant first.

create index if not exists inventories_variant_idx
  on inventories (variant_id, store_id);

-- Ficha do cliente lista todas as vendas, não só finalizadas (o parcial não serve)
create index if not exists sales_customer_all_idx
  on sales (customer_id, sold_at desc);

create index if not exists customer_notes_customer_idx
  on customer_notes (customer_id, created_at desc);

create index if not exists crm_tasks_customer_all_idx
  on crm_tasks (customer_id, created_at desc);
