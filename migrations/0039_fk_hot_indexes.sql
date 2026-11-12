-- P2 da auditoria de DBA (HANDOFF itens 184/186), so o subconjunto QUENTE.
--
-- O Postgres nao indexa coluna de FK sozinho; a auditoria achou 60 sem
-- indice. Indexar as 60 seria custo de escrita sem retorno -- aqui entram
-- so as que os fluxos reais do app percorrem hoje:
--
--   - return_items.sale_item_id: o lateral RETURN_BY_SALE (insight.ts/
--     commerce.ts) roda POR VENDA em todo agregado de faturamento --
--     dashboard, vendas, relatorios. O join mais quente do sistema.
--   - returns.sale_id, accounts_receivable.sale_id: detalhe da venda e
--     crediario buscam por venda.
--   - accounts_payable.purchase_id/supplier_id: ficha 360 do fornecedor.
--   - commissions.seller_id: folha/pagamentos por vendedor.
--   - sale_items.product_id/variant_id: historico de venda por produto.
--   - purchase_items.purchase_id: linhas do pedido (getPurchaseFn).
--   - cash_movements.store_id: extrato do caixa por loja.
--   - payments.company_id, inventories.company_id: as duas tabelas do
--     relatorio "multi-tenant sem indice liderado por company_id" com
--     listagem de empresa inteira de verdade (relatorios de pagamento e
--     tela de Estoque em "todas as lojas").
--
-- Sem CONCURRENTLY de proposito: o migrate.mjs roda cada arquivo numa
-- transacao (CONCURRENTLY nao pode), e com o banco deste tamanho o lock e
-- instantaneo. Revisitar o restante das 60 quando o pg_stat_statements
-- (ligado na 0038) apontar gargalo medido, nao suposto.

create index if not exists return_items_sale_item_idx on return_items (sale_item_id);
create index if not exists returns_sale_idx on returns (sale_id);
create index if not exists accounts_receivable_sale_idx on accounts_receivable (sale_id);
create index if not exists accounts_payable_purchase_idx on accounts_payable (purchase_id);
create index if not exists accounts_payable_supplier_idx on accounts_payable (supplier_id);
create index if not exists commissions_seller_idx on commissions (seller_id);
create index if not exists sale_items_product_idx on sale_items (product_id);
create index if not exists sale_items_variant_idx on sale_items (variant_id);
create index if not exists purchase_items_purchase_idx on purchase_items (purchase_id);
create index if not exists cash_movements_store_idx on cash_movements (store_id);
create index if not exists payments_company_idx on payments (company_id);
create index if not exists inventories_company_idx on inventories (company_id);
