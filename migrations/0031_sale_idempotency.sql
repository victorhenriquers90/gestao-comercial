-- Chave de idempotencia do checkout.
--
-- Uma falha de rede bem no instante em que o servidor ja comitou a venda
-- deixava o operador sem confirmacao na tela -- e um reenvio natural
-- (recarregar, abrir outra aba, clicar de novo) duplicava a venda inteira,
-- com baixa de estoque em dobro. Reproduzido ao vivo nesta sessao.
--
-- O cliente gera uma chave por TENTATIVA de fechamento e reenvia a MESMA
-- chave em cada retry daquela tentativa; o servidor devolve a venda ja
-- gravada em vez de criar outra. Unica por empresa (nao globalmente), do
-- mesmo jeito que document/barcode em 0020_document_unique.sql.

alter table sales add column if not exists idempotency_key text;

create unique index if not exists sales_idempotency_key_uidx
  on sales (company_id, idempotency_key)
  where idempotency_key is not null;
