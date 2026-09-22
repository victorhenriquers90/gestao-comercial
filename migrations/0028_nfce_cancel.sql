-- Cancelamento de NFC-e e a pendencia fiscal que sobra quando ele nao rola.
--
-- O QUE ESTAVA ERRADO
--
-- Cancelar a venda estornava estoque, comissao e recebivel -- e nao tocava
-- na nota. Devolucao parcial, idem. Ficava uma NFC-e AUTORIZADA para uma
-- venda que nao existe mais: valida pro SEFAZ, com imposto apurado em cima
-- dela. O lado do dinheiro fechava e o lado fiscal mentia, em silencio.
--
-- A DECISAO QUE DEFINE ESTE RECURSO
--
-- Nem toda divergencia tem conserto dentro do sistema, e fingir que tem e
-- pior do que nao ter:
--
--   dentro de ~30 min   cancelamento no SEFAZ resolve
--   fora do prazo       so com NF-e DE DEVOLUCAO (modelo 55, entrada,
--                       referenciando a chave) -- outro documento, que este
--                       sistema nao emite
--   devolucao PARCIAL   cancelar seria errado: a venda aconteceu, so que
--                       por um valor menor
--
-- Nos dois ultimos casos grava-se `nfce_pendencia`: texto explicito, que
-- aparece na venda e no sino, e so sai quando alguem resolve. Uma
-- divergencia visivel e um problema; a mesma divergencia invisivel e um
-- problema que aparece na fiscalizacao.
--
-- `nfce_cancel_protocol` guarda o numero de protocolo devolvido pelo SEFAZ:
-- e a prova de que o cancelamento existiu, e sem ela a unica evidencia seria
-- o status 'cancelado' -- que qualquer update produz.

-- Quando o SEFAZ autorizou. A janela de cancelamento conta DAQUI, nao de
-- sold_at: a nota pode ser emitida bem depois da venda, e medir pela venda
-- diria "fora do prazo" numa nota recem-autorizada.
alter table sales add column if not exists nfce_authorized_at timestamptz;
alter table sales add column if not exists nfce_pendencia text;
alter table sales add column if not exists nfce_cancel_protocol text;
alter table sales add column if not exists nfce_cancelled_at timestamptz;

-- Pendencia fiscal e sempre "as que estao abertas", nunca a tabela toda.
create index if not exists sales_nfce_pendencia_idx
  on sales (company_id, id desc)
  where nfce_pendencia is not null;
