-- Unique CPF/CNPJ per tenant (empty excluded). Seed check digits corrected
-- so editing Camila / fornecedor / EAN no longer fails validation.

update sellers set document = '41582739005' where document = '41582739011';
update sellers set document = '26318475044' where document = '26318475090';
update sellers set document = '39817264000178' where document = '39817264000155';
update suppliers set document = '44555666000181' where document = '44555666000172';

update products set barcode = '7891000000014' where barcode = '7891000000011';
update products set barcode = '7891000000021' where barcode = '7891000000028';
update products set barcode = '7891000000038' where barcode = '7891000000035';
update products set barcode = '7891000000045' where barcode = '7891000000042';
update products set barcode = '7891000000052' where barcode = '7891000000059';
update products set barcode = '7891000000069' where barcode = '7891000000066';
update products set barcode = '7891000000076' where barcode = '7891000000073';
update products set barcode = '7891000000083' where barcode = '7891000000080';
update products set barcode = '7891000000090' where barcode = '7891000000097';
update products set barcode = '7891000000106' where barcode = '7891000000103';
update products set barcode = '7891000000113' where barcode = '7891000000110';
update products set barcode = '7891000000120' where barcode = '7891000000127';

update product_variants set barcode = '7891000000014' where barcode = '7891000000011';
update product_variants set barcode = '7891000000021' where barcode = '7891000000028';
update product_variants set barcode = '7891000000038' where barcode = '7891000000035';
update product_variants set barcode = '7891000000045' where barcode = '7891000000042';
update product_variants set barcode = '7891000000052' where barcode = '7891000000059';
update product_variants set barcode = '7891000000069' where barcode = '7891000000066';
update product_variants set barcode = '7891000000076' where barcode = '7891000000073';
update product_variants set barcode = '7891000000083' where barcode = '7891000000080';
update product_variants set barcode = '7891000000090' where barcode = '7891000000097';
update product_variants set barcode = '7891000000106' where barcode = '7891000000103';
update product_variants set barcode = '7891000000113' where barcode = '7891000000110';
update product_variants set barcode = '7891000000120' where barcode = '7891000000127';

create unique index if not exists customers_document_uidx
  on customers (company_id, document)
  where document is not null and document <> '' and deleted_at is null;

create unique index if not exists sellers_document_uidx
  on sellers (company_id, document)
  where document is not null and document <> '' and deleted_at is null;

create unique index if not exists suppliers_document_uidx
  on suppliers (company_id, document)
  where document is not null and document <> '' and deleted_at is null;

create unique index if not exists products_barcode_uidx
  on products (company_id, barcode)
  where barcode is not null and barcode <> '' and deleted_at is null;
