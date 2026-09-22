-- Ambiente em que cada NFC-e foi emitida.
--
-- O QUE ESTAVA ERRADO
--
-- Nota de homologacao e nota de producao ficavam identicas na tabela: as
-- duas gravam nfce_status = 'autorizado', chave, numero, serie e link de
-- DANFE. Homologacao existe pra testar, entao esses testes VAO acontecer --
-- e no dia seguinte a venda aparece "com nota" sem ter nota nenhuma.
--
-- Duas consequencias, as duas caras:
--
--   1. A tela nao oferecia emitir de novo numa venda ja "autorizada". As
--      vendas usadas pra testar ficariam para sempre sem documento fiscal,
--      parecendo que tem.
--   2. Qualquer relatorio fiscal futuro somaria as duas como se fossem a
--      mesma coisa.
--
-- Guardar o ambiente na propria linha resolve os dois: a emissao real passa
-- a ser permitida por cima de um teste, e nada que saiu de homologacao pode
-- se passar por documento.
--
-- Fica NULO pras notas antigas. Nao ha nenhuma (zero linhas com nfce_ref
-- quando esta migration foi escrita), entao nulo aqui significa "de antes
-- do controle", nao "producao" -- e o codigo trata nulo como desconhecido em
-- vez de supor o ambiente mais favoravel.

alter table sales add column if not exists nfce_env text;

do $$ begin
  alter table sales add constraint sales_nfce_env_valid check (
    nfce_env is null or nfce_env in ('homologacao', 'producao')
  ) not valid;
exception when duplicate_object then null;
end $$;
