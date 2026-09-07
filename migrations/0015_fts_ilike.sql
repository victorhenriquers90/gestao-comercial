-- ILIKE '%x%' cannot use btree. PGLite has no pg_trgm, so:
--   GIN FTS (words in any order) + btree prefix (lower(col) text_pattern_ops).

create index if not exists products_name_fts_idx
  on products using gin (to_tsvector('simple', coalesce(name, '')));
create index if not exists products_name_prefix_idx
  on products (company_id, lower(name) text_pattern_ops);
create index if not exists products_sku_prefix_idx
  on products (company_id, lower(sku) text_pattern_ops);

create index if not exists variants_sku_prefix_idx
  on product_variants (company_id, lower(sku) text_pattern_ops);

create index if not exists customers_name_fts_idx
  on customers using gin (to_tsvector('simple', coalesce(name, '')));
create index if not exists customers_name_prefix_idx
  on customers (company_id, lower(name) text_pattern_ops);

create index if not exists suppliers_legal_fts_idx
  on suppliers using gin (to_tsvector('simple', coalesce(legal_name, '') || ' ' || coalesce(trade_name, '')));
create index if not exists suppliers_legal_prefix_idx
  on suppliers (company_id, lower(legal_name) text_pattern_ops);
