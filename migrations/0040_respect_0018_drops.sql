-- Correcao da 0039, no mesmo dia: ela recriou DOIS indices que a 0018
-- tinha derrubado de proposito, com justificativa escrita -- "cut write
-- amplification on F10" -- e a 0039 nao cruzou a lista dela antes de sair
-- da auditoria mecanica (colunas de FK sem indice) pra criacao:
--
--   - sale_items_product_idx: 0018 diz "mix/ABC filtra variant_id;
--     product_id no item e coberto pelo join do produto".
--   - inventories_company_idx: 0018 diz "unique (store_id, variant_id) +
--     (variant_id) INCLUDE quantity; company_id sozinho nao discrimina".
--
-- Decisao registrada vence achado mecanico: caem de novo. Se um dia o
-- pg_stat_statements (0038) provar o contrario com numero, ai sim volta --
-- revogando a 0018 por escrito, nao por acidente.
--
-- Nota: as outras duas colisoes de nome da 0039 (sale_items_variant_idx e
-- commissions_seller_idx) foram inofensivas -- o IF NOT EXISTS preservou as
-- versoes COMPOSTAS da 0011 (lideradas por company_id), que sao melhores
-- pros filtros reais do app; as linhas da 0039 pra elas sao no-op em
-- qualquer ambiente, instalacao nova inclusa (0011 roda antes).

drop index if exists sale_items_product_idx;
drop index if exists inventories_company_idx;
