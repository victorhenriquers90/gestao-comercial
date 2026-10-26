-- Trava no banco pros mesmos limites que ja existiam so na aplicacao.
--
-- O QUE ESTAVA ERRADO
--
-- Varios campos de dinheiro/percentual ja tem CHECK no banco (payments,
-- sale_items, sales, commissions, cash_registers, card_rates...), mas um
-- grupo igualmente critico nao tinha nenhum: memberships.discount_limit,
-- commission_rules.percent, product_variants.cost/price, products.cost/
-- price, purchases.total/discount/freight/tax, accounts_receivable e
-- accounts_payable (amount/discount/*_amount). A unica coisa impedindo um
-- valor negativo ou um percentual de comissao de 50000% ali era a validacao
-- da aplicacao (requireRange/parseUnitCost/parsePurchaseExtra) -- achado
-- revisando o sistema como DBA depois de ja ter corrigido essas mesmas
-- lacunas no codigo (ver HANDOFF.md, itens 116-118). Se algum caminho
-- futuro no codigo esquecer de validar, hoje o banco aceita.
--
-- NOT VALID de proposito, mesmo padrao de cash_registers_close_sane
-- (0025): vale pro que entrar daqui pra frente, sem varrer a tabela da loja
-- em producao no meio da atualizacao. Dado atual conferido antes de
-- escrever esta migracao -- zero linha violaria qualquer uma destas.

do $$ begin
  alter table memberships add constraint memberships_discount_limit_range check (
    discount_limit is null or (discount_limit >= 0 and discount_limit <= 100)
  ) not valid;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table commission_rules add constraint commission_rules_percent_range check (
    percent >= 0 and (
      case when kind = 'fixed_unit' then percent <= 10000 else percent <= 100 end
    )
  ) not valid;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table product_variants add constraint product_variants_money_nonneg check (
    (cost is null or cost >= 0) and (price is null or price >= 0)
  ) not valid;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table products add constraint products_money_nonneg check (
    cost >= 0 and price >= 0
  ) not valid;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table purchases add constraint purchases_money_nonneg check (
    discount >= 0 and freight >= 0 and tax >= 0 and total >= 0
  ) not valid;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table accounts_receivable add constraint accounts_receivable_money_nonneg check (
    amount >= 0 and discount >= 0 and received_amount >= 0
  ) not valid;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table accounts_payable add constraint accounts_payable_money_nonneg check (
    amount >= 0 and discount >= 0 and paid_amount >= 0
  ) not valid;
exception when duplicate_object then null;
end $$;
