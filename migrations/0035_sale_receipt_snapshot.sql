-- Congela o cabecalho/rodape/mensagem do comprovante no momento da venda,
-- mesmo motivo do `document` (migration 0021): sem isto, reimprimir uma
-- venda antiga (Vendas -> ver venda) mostrava o texto ATUAL de
-- Configuracoes, nao o que o cliente recebeu de verdade na hora da compra.
-- Vendas anteriores a esta migration ficam NULL -- a tela cai de volta pro
-- texto atual nesse caso (unico jeito de nao ter o que mostrar).

alter table sales add column if not exists print_header text;
alter table sales add column if not exists print_footer text;
alter table sales add column if not exists receipt_message text;
