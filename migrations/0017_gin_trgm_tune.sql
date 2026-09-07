-- GIN trgm: pending list (fastupdate) delays visibility under load.
-- Catalog writes are rare — turn it off so F2 sees the new name immediately.
-- Partial: deleted products stay out of the posting lists.

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_trgm') then
    return;
  end if;

  execute 'drop index if exists products_name_trgm_idx';
  execute $i$
    create index products_name_trgm_idx
      on products using gin (name gin_trgm_ops)
      with (fastupdate = off)
      where deleted_at is null
  $i$;

  execute 'drop index if exists products_sku_trgm_idx';
  execute $i$
    create index products_sku_trgm_idx
      on products using gin (sku gin_trgm_ops)
      with (fastupdate = off)
      where deleted_at is null
  $i$;

  execute 'drop index if exists variants_sku_trgm_idx';
  execute $i$
    create index variants_sku_trgm_idx
      on product_variants using gin (sku gin_trgm_ops)
      with (fastupdate = off)
      where deleted_at is null
  $i$;

  execute 'drop index if exists customers_name_trgm_idx';
  execute $i$
    create index customers_name_trgm_idx
      on customers using gin (name gin_trgm_ops)
      with (fastupdate = off)
      where deleted_at is null
  $i$;

  execute 'drop index if exists suppliers_legal_trgm_idx';
  execute $i$
    create index suppliers_legal_trgm_idx
      on suppliers using gin (legal_name gin_trgm_ops)
      with (fastupdate = off)
      where deleted_at is null
  $i$;

  execute 'drop index if exists suppliers_trade_trgm_idx';
  execute $i$
    create index suppliers_trade_trgm_idx
      on suppliers using gin (trade_name gin_trgm_ops)
      with (fastupdate = off)
      where deleted_at is null
  $i$;
end $$;
