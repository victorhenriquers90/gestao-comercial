-- Fechamento de caixa com conferencia CEGA.
--
-- O QUE ESTAVA ERRADO
--
-- A tela do caixa mostrava "Dinheiro esperado" o turno inteiro, e o campo da
-- contagem ficava logo abaixo dele. Conferencia em que a resposta esta na
-- tela nao e conferencia, e transcricao: o operador le o esperado, digita o
-- esperado, e o fechamento fecha perfeito todo dia -- inclusive nos dias em
-- que nao deveria.
--
-- A DECISAO QUE DEFINE ESTE RECURSO
--
-- A trava nao e esconder o numero. Quem quiser somar as vendas do dia numa
-- outra tela consegue, e fingir o contrario seria construir um controle de
-- mentira. A trava e a ORDEM DOS FATOS:
--
--   o contado e gravado, com autor e hora, NA MESMA transacao em que o
--   esperado e calculado -- e o esperado so existe DEPOIS disso.
--
-- Por isso nao ha "registrar contagem" e depois "fechar": seriam dois
-- momentos, e entre eles caberia uma venda mudando o esperado por baixo de
-- uma contagem ja feita. Um passo so fecha essa janela.
--
-- Esconder o numero da tela continua valendo, por outro motivo: tirar a
-- ancora de quem conta de boa-fe, que e a maioria dos fechamentos. Um
-- gerente ainda pode revelar o esperado antes do fechamento -- e ai o
-- registro guarda que revelou (expected_revealed_at). Fechamento que nao foi
-- cego nao pode PARECER cego na hora de auditar.

alter table cash_registers add column if not exists closed_by text;
alter table cash_registers add column if not exists count_breakdown jsonb;
alter table cash_registers add column if not exists difference_reason text;
alter table cash_registers add column if not exists difference_explained_at timestamptz;
alter table cash_registers add column if not exists difference_explained_by text;
alter table cash_registers add column if not exists expected_revealed_at timestamptz;
alter table cash_registers add column if not exists expected_revealed_by text;

-- NaN passa por "> 0" e por ">= 0" no Postgres (NaN ordena acima de
-- qualquer numero), entao checagem de sinal sozinha nao segura valor
-- invalido. NaN = NaN e verdadeiro aqui, logo "<> 'NaN'" e o teste que
-- funciona. NOT VALID de proposito: vale pro que entrar daqui pra frente,
-- sem varrer a tabela da loja em producao no meio de uma atualizacao.
do $$ begin
  alter table cash_registers add constraint cash_registers_close_sane check (
    (closing_amount is null or (closing_amount >= 0 and closing_amount <> 'NaN'::numeric))
    and (expected_amount is null or expected_amount <> 'NaN'::numeric)
    and (difference_amount is null or difference_amount <> 'NaN'::numeric)
  ) not valid;
exception when duplicate_object then null;
end $$;

-- Fechamentos recentes e divergencias por explicar sao sempre "os ultimos",
-- nunca a tabela toda.
create index if not exists cash_registers_closed_idx
  on cash_registers (company_id, closed_at desc)
  where status = 'closed';
