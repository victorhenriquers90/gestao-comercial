-- Cartao: taxa da maquininha, prazo de recebimento e NSU.
--
-- Ate aqui uma venda no credito entrava no sistema como dinheiro disponivel
-- na hora. Na loja real o dinheiro chega liquido (menos a taxa da
-- adquirente) e depois (D+1 no debito, D+30 no credito, parcela a parcela no
-- parcelado). So o crediario virava conta a receber, entao o "Saldo
-- financeiro" do painel era otimista por construcao.
--
-- Cartao passa a se comportar como o crediario -- que ja e o modelo que
-- funciona nesta base: gera conta a receber pelo liquido, com a data em que
-- o dinheiro realmente cai.

-- Taxas negociadas pela loja. Sem linha nenhuma aqui, o codigo usa o padrao
-- de src/lib/card.ts: prazo certo (D+1 / D+30) e taxa ZERO -- porque o prazo
-- vale pra qualquer loja, mas o percentual e negociado caso a caso e chutar
-- um numero inventaria despesa que ninguem conferiu.
create table if not exists card_rates (
  id serial primary key,
  company_id integer not null references companies(id),
  method text not null,
  -- null = vale pra qualquer bandeira (a regra geral da loja).
  brand text,
  min_installments integer not null default 1,
  max_installments integer not null default 1,
  fee_pct numeric(6,3) not null default 0,
  settlement_days integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists card_rates_company_idx on card_rates (company_id, method);

do $$ begin
  alter table card_rates add constraint card_rates_method_check
    check (method in ('debito', 'credito'));
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table card_rates add constraint card_rates_range_check
    check (min_installments >= 1 and max_installments >= min_installments);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table card_rates add constraint card_rates_fee_check
    check (fee_pct >= 0 and fee_pct < 100 and settlement_days >= 0);
exception when duplicate_object then null;
end $$;

-- Guardado no proprio pagamento: e o que permite conferir uma venda contra a
-- linha do extrato da adquirente sem recalcular nada.
alter table payments add column if not exists fee_amount numeric(14,2) not null default 0;
alter table payments add column if not exists net_amount numeric(14,2);
alter table payments add column if not exists nsu text;

-- De onde a conta a receber veio. Sem isto, depois que o cartao passa a
-- gerar recebivel, nao da mais pra separar no relatorio o que e fiado do
-- cliente (crediario) do que e repasse da adquirente (cartao) -- sao riscos
-- e cobrancas completamente diferentes.
alter table accounts_receivable add column if not exists origin text not null default 'manual';
alter table accounts_receivable add column if not exists payment_id integer references payments(id);
create index if not exists ar_origin_idx on accounts_receivable (company_id, origin);

-- Recebiveis de crediario que ja existem ficam marcados como tal, senao
-- passariam a contar como "manual" e sumiriam do filtro de crediario.
update accounts_receivable
   set origin = 'crediario'
 where origin = 'manual'
   and sale_id is not null;
