-- Hot paths: PDV F2, dashboard, mix de produtos, comissão, caixa, contas em aberto.

-- F2: exact SKU / código interno (barcode já tinha índice)
create index if not exists products_sku_idx on products (company_id, sku);
create index if not exists products_internal_idx on products (company_id, internal_code);
create index if not exists variants_sku_idx on product_variants (company_id, sku);

-- Painel e relatórios: só vendas vivas, por data / loja / vendedor
create index if not exists sales_finalized_idx
  on sales (company_id, sold_at desc)
  where deleted_at is null and status = 'finalizada';

create index if not exists sales_store_finalized_idx
  on sales (store_id, sold_at desc)
  where deleted_at is null and status = 'finalizada';

create index if not exists sales_seller_idx
  on sales (company_id, seller_id, sold_at desc)
  where deleted_at is null;

-- Curva ABC / mix: itens por peça, não só por cupom
create index if not exists sale_items_variant_idx on sale_items (company_id, variant_id);
create index if not exists sale_items_product_idx on sale_items (company_id, product_id);

-- Folha de comissão e estorno no caixa
create index if not exists commissions_seller_idx on commissions (company_id, seller_id, created_at desc);
create index if not exists commissions_sale_idx on commissions (sale_id);
create index if not exists cash_movements_sale_idx on cash_movements (sale_id);

-- Dashboard: a receber / a pagar em aberto
create index if not exists ar_open_idx
  on accounts_receivable (company_id)
  where deleted_at is null and status in ('pendente', 'parcial');

create index if not exists ap_open_idx
  on accounts_payable (company_id)
  where deleted_at is null and status in ('pendente', 'parcial');

-- Checkout carrega promoções ativas; listagens menores
create index if not exists promotions_company_idx on promotions (company_id, is_active);
create index if not exists returns_company_idx on returns (company_id, created_at desc);
create index if not exists expenses_company_idx on expenses (company_id, spent_at desc);
