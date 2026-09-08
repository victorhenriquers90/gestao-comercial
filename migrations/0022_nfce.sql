-- Suporte a emissao de NFC-e via Focus NFe (API de terceiro; ver
-- src/lib/server/nfce.ts). Token/ambiente ficam em variavel de ambiente
-- (FOCUS_NFE_TOKEN / FOCUS_NFE_ENV), nao no banco -- mesmo padrao ja usado
-- pra XAI_API_KEY.

alter table companies add column if not exists ie text;
alter table companies add column if not exists tax_regime text not null default 'simples';

alter table company_settings add column if not exists nfce_enabled boolean not null default false;

-- NCM e por produto e nao tem default seguro (classificacao fiscal real);
-- fica nulo ate o lojista preencher. CFOP de venda local (mesmo estado) e
-- o mesmo pra quase toda venda de NFC-e, entao tem default.
alter table products add column if not exists ncm text;
alter table products add column if not exists cfop text not null default '5102';

alter table sales add column if not exists nfce_status text;
alter table sales add column if not exists nfce_ref text;
alter table sales add column if not exists nfce_chave text;
alter table sales add column if not exists nfce_numero text;
alter table sales add column if not exists nfce_serie text;
alter table sales add column if not exists nfce_danfe_url text;
alter table sales add column if not exists nfce_xml_url text;
alter table sales add column if not exists nfce_error text;

create unique index if not exists sales_nfce_ref_uidx
  on sales (company_id, nfce_ref)
  where nfce_ref is not null;
