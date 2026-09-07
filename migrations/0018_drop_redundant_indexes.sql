-- Cut write amplification on F10. Each extra btree is WAL + a random page
-- on every cupom. These were prefixes/subsets of indexes we already keep.

-- sales (company_id, sold_at) already covers dashboard; partial duplicate.
drop index if exists sales_finalized_idx;
drop index if exists sales_store_finalized_idx;

-- ficha uses sales_customer_all_idx; covering parcial era o 2º insert no mesmo cupom.
drop index if exists sales_customer_idx;

-- mix/ABC filtra variant_id; product_id no item é coberto pelo join do produto.
drop index if exists sale_items_product_idx;

-- unique (store_id, variant_id) + (variant_id) INCLUDE quantity; company_id sozinho não discrimina.
drop index if exists inventories_company_idx;

-- promotions_live_idx (ativas + vigência) substitui (company_id, is_active).
drop index if exists promotions_company_idx;

-- commissions (company_id, seller_id, created_at) cobre a folha pendente.
drop index if exists commissions_pending_idx;
