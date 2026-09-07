-- Trigram indexes for ILIKE '%texto%'. Optional: PGLite has no pg_trgm; Neon does.
-- GIN (not GiST): lookup of contains. GiST would be ORDER BY similarity().
-- ILIKE does not use similarity_threshold; the % operator does (default 0.3).

do $$
begin
  create extension if not exists pg_trgm;
exception when others then
  raise notice 'pg_trgm unavailable — prefix + FTS stay in charge';
end $$;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_trgm') then
    return;
  end if;
  execute 'create index if not exists products_name_trgm_idx on products using gin (name gin_trgm_ops)';
  execute 'create index if not exists products_sku_trgm_idx on products using gin (sku gin_trgm_ops)';
  execute 'create index if not exists variants_sku_trgm_idx on product_variants using gin (sku gin_trgm_ops)';
  execute 'create index if not exists customers_name_trgm_idx on customers using gin (name gin_trgm_ops)';
  execute 'create index if not exists suppliers_legal_trgm_idx on suppliers using gin (legal_name gin_trgm_ops)';
  execute 'create index if not exists suppliers_trade_trgm_idx on suppliers using gin (trade_name gin_trgm_ops)';
end $$;
