-- Vinculo da despesa com o dinheiro que saiu da gaveta.
--
-- Despesa paga em dinheiro gera uma movimentacao `sangria_liquidacao` no caixa
-- aberto, mas as duas linhas nao se conheciam: so a descricao ("Despesa: ...")
-- ligava uma a outra. Para poder CANCELAR a despesa e devolver o dinheiro ao
-- esperado do caixa sem adivinhar qual movimentacao e a dela, a despesa passa a
-- guardar a forma de pagamento e o id da movimentacao.
--
-- Despesas antigas ficam com os dois campos nulos (nao ha como saber), e o
-- cancelamento delas so e permitido quando nao existe movimentacao de caixa
-- com a mesma descricao.

alter table expenses add column if not exists method text;
alter table expenses add column if not exists cash_movement_id integer references cash_movements(id);
