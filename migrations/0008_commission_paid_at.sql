-- Data do pagamento, usada na guia de retenções (INSS/IRRF/ISS a recolher).

alter table commissions
  add column if not exists paid_at timestamptz;
