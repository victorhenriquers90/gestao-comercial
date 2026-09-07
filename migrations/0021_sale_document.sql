-- Persiste o documento (CPF/CNPJ) usado na nota no momento da venda, em vez
-- de depender do documento *atual* do cliente vinculado (que pode mudar).

alter table sales add column if not exists document text;

update sales s
   set document = c.document
  from customers c
 where c.id = s.customer_id
   and s.document is null
   and c.document is not null;
