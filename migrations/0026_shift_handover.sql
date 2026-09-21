-- Troca de turno.
--
-- O QUE ESTAVA ERRADO
--
-- O caixa e por LOJA, nao por operador. Duas pessoas no mesmo dia viravam um
-- fechamento so, e a diferenca perdia o dono: falta de R$ 40 num turno tem
-- hora e responsavel, a mesma falta dividida entre duas pessoas que nunca
-- conferiram nada entre si nao tem nada.
--
-- A DECISAO QUE DEFINE ESTE RECURSO
--
-- A troca NAO abre o turno seguinte. Seria comodo um botao que fecha o de
-- quem sai e ja abre o de quem entra, escolhido numa lista -- e gravaria que
-- B e responsavel por um turno em que B nunca se autenticou. Se esse turno
-- fechar com falta, o sistema acusaria B por causa de um clique de A. Isso e
-- pior do que nao separar turno nenhum: fabrica responsabilidade falsa.
--
-- Entao a troca tem dois lados, cada um no seu proprio login:
--
--   handover_amount       quem SAI conta as cegas, fecha, e declara quanto
--                         FICA na gaveta (o resto vai pro cofre)
--   previous_register_id  quem ENTRA conta a gaveta recebida -- tambem as
--   opening_verified      cegas -- e so depois ve o que o outro declarou
--
-- A segunda contagem e o que faz a troca valer. Quem entra e apenas aceita o
-- numero do outro herda o erro alheio, e a diferenca volta a nao ter dono. E
-- a hora de achar um desencontro e essa, com as duas pessoas na frente da
-- gaveta -- nao no fim do turno seguinte.
--
-- `opening_verified` guarda se quem abriu contou de verdade. Sem essa marca,
-- um turno aberto no olho e um turno conferido ficariam identicos no
-- relatorio, e a diferenca dos dois seria lida com a mesma confianca.

alter table cash_registers add column if not exists handover_amount numeric(14,2);
alter table cash_registers add column if not exists previous_register_id integer references cash_registers(id);
alter table cash_registers add column if not exists opening_verified boolean not null default false;

-- NaN passa por ">= 0" no Postgres (ordena acima de qualquer numero), entao
-- checagem de sinal sozinha nao segura valor invalido; "<> 'NaN'" e o teste
-- que funciona. E deixar na gaveta mais do que foi contado inventaria
-- dinheiro na virada. NOT VALID: vale do que entrar daqui pra frente, sem
-- varrer a tabela da loja durante uma atualizacao.
do $$ begin
  alter table cash_registers add constraint cash_registers_handover_sane check (
    handover_amount is null
    or (
      handover_amount >= 0
      and handover_amount <> 'NaN'::numeric
      and (closing_amount is null or handover_amount <= closing_amount)
    )
  ) not valid;
exception when duplicate_object then null;
end $$;

-- Um fechamento so pode ser consumido por UM turno seguinte. Sem isto, duas
-- aberturas simultaneas herdariam o mesmo troco e o dinheiro apareceria
-- duplicado na cadeia do dia.
create unique index if not exists cash_registers_previous_once_idx
  on cash_registers (previous_register_id)
  where previous_register_id is not null;
