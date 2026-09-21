-- Inventario (contagem fisica / balanco).
--
-- Ate aqui o saldo so mudava por venda, compra, devolucao, transferencia ou
-- ajuste avulso. Nao havia como conferir o que existe na PRATELEIRA contra o
-- que o sistema acha que existe -- e em loja de roupa o saldo desencontra
-- sozinho (peca trocada de tamanho no provador, furto, recebimento contado
-- errado). Sem contagem, o "Estoque baixo" do painel vai ficando ficcao.
--
-- A DECISAO QUE DEFINE ESTE RECURSO
--
-- Ao aplicar, lanca-se a DIFERENCA encontrada na contagem, nao o valor
-- contado como saldo absoluto. Parece detalhe e nao e:
--
--   10:00  sistema diz 10, a prateleira tem 8   -> diferenca -2
--   11:00  vendem-se 2                          -> sistema 8, prateleira 6
--   12:00  aplica-se o inventario
--
--   pela diferenca:  8 - 2 = 6   confere com a prateleira
--   pelo absoluto:   vira 8      inventa 2 pecas que ja foram vendidas
--
-- Ou seja: o metodo "absoluto" so funciona com a loja parada. Guardando o
-- esperado no momento da contagem e aplicando a diferenca, a loja pode
-- continuar vendendo enquanto conta.

create table if not exists stock_counts (
  id serial primary key,
  company_id integer not null references companies(id),
  store_id integer not null references stores(id),
  -- aberto | aplicado | cancelado
  status text not null default 'aberto',
  note text,
  user_id text not null,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  applied_by text
);
create index if not exists stock_counts_company_idx on stock_counts (company_id, status, created_at desc);

do $$ begin
  alter table stock_counts add constraint stock_counts_status_check
    check (status in ('aberto', 'aplicado', 'cancelado'));
exception when duplicate_object then null;
end $$;

-- Um inventario aberto por loja. Duas contagens simultaneas na mesma loja
-- gravariam "esperado" a partir de saldos que a outra ainda vai mexer, e a
-- diferenca de uma anularia a da outra.
create unique index if not exists stock_counts_one_open_idx
  on stock_counts (store_id) where status = 'aberto';

create table if not exists stock_count_items (
  id serial primary key,
  company_id integer not null references companies(id),
  count_id integer not null references stock_counts(id) on delete cascade,
  variant_id integer not null references product_variants(id),
  -- Saldo do sistema no instante em que a peca foi contada. E o que permite
  -- aplicar pela diferenca depois (ver o cabecalho deste arquivo).
  expected numeric(14,3) not null,
  counted numeric(14,3) not null,
  counted_at timestamptz not null default now(),
  counted_by text
);
create unique index if not exists stock_count_items_uidx
  on stock_count_items (count_id, variant_id);
create index if not exists stock_count_items_count_idx on stock_count_items (count_id);

do $$ begin
  alter table stock_count_items add constraint stock_count_items_counted_check
    check (counted >= 0);
exception when duplicate_object then null;
end $$;
