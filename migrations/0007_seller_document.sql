-- CPF/CNPJ do vendedor, usado no RPA / demonstrativo de comissão.

alter table sellers
  add column if not exists document text;
