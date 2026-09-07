-- INCLUDE (quantity) counted as an indexed column, so UPDATE quantity
-- could not use Heap-Only Tuple and rebalanced the covering index on every F10.
-- Lookup still uses (variant_id, store_id); quantity comes from the heap (1 page).

drop index if exists inventories_variant_idx;
create index if not exists inventories_variant_idx
  on inventories (variant_id, store_id);
