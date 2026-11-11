-- P1 da auditoria de DBA (HANDOFF item 184), duas coisas:
--
-- 1) VALIDATE CONSTRAINT nas 10 CHECKs que nasceram NOT VALID (0010 nao --
--    aquelas ja nasceram validando -- mas 0025/0026/0027/0036 sim).
--    NOT VALID protege so escrita nova; o historico nunca foi carimbado.
--    A auditoria ja conferiu ao vivo que o dado atual passa (zero violacao
--    nas contagens de dinheiro negativo etc.), entao validar e barato
--    (banco de 12 MB, lock SHARE UPDATE EXCLUSIVE, nao bloqueia trafego).
--
--    Cada VALIDATE vive num DO proprio que degrada pra RAISE WARNING se
--    alguma linha historica violar (check_violation): a constraint fica
--    NOT VALID como estava -- nada pior que hoje -- e o deploy NAO trava.
--    Qualquer OUTRO erro continua estourando a migration, de proposito.
--    O migrate.mjs agora escuta 'notice' e imprime esses avisos no log de
--    build, entao um pulo nao passa em silencio.
--
-- 2) pg_stat_statements: a auditoria achou a extensao desligada -- zero
--    visibilidade de query lenta em producao. O Neon suporta nativamente.
--    WHEN OTHERS (nao um codigo especifico) porque o PGLite do preview nao
--    embarca essa extensao e o erro exato varia por backend; sem telemetria
--    de query no preview nao se perde nada.

do $$ begin
  alter table accounts_payable validate constraint accounts_payable_money_nonneg;
exception when check_violation then
  raise warning 'accounts_payable_money_nonneg segue NOT VALID: linha historica viola (%).', sqlerrm;
end $$;

do $$ begin
  alter table accounts_receivable validate constraint accounts_receivable_money_nonneg;
exception when check_violation then
  raise warning 'accounts_receivable_money_nonneg segue NOT VALID: linha historica viola (%).', sqlerrm;
end $$;

do $$ begin
  alter table cash_registers validate constraint cash_registers_close_sane;
exception when check_violation then
  raise warning 'cash_registers_close_sane segue NOT VALID: linha historica viola (%).', sqlerrm;
end $$;

do $$ begin
  alter table cash_registers validate constraint cash_registers_handover_sane;
exception when check_violation then
  raise warning 'cash_registers_handover_sane segue NOT VALID: linha historica viola (%).', sqlerrm;
end $$;

do $$ begin
  alter table commission_rules validate constraint commission_rules_percent_range;
exception when check_violation then
  raise warning 'commission_rules_percent_range segue NOT VALID: linha historica viola (%).', sqlerrm;
end $$;

do $$ begin
  alter table memberships validate constraint memberships_discount_limit_range;
exception when check_violation then
  raise warning 'memberships_discount_limit_range segue NOT VALID: linha historica viola (%).', sqlerrm;
end $$;

do $$ begin
  alter table product_variants validate constraint product_variants_money_nonneg;
exception when check_violation then
  raise warning 'product_variants_money_nonneg segue NOT VALID: linha historica viola (%).', sqlerrm;
end $$;

do $$ begin
  alter table products validate constraint products_money_nonneg;
exception when check_violation then
  raise warning 'products_money_nonneg segue NOT VALID: linha historica viola (%).', sqlerrm;
end $$;

do $$ begin
  alter table purchases validate constraint purchases_money_nonneg;
exception when check_violation then
  raise warning 'purchases_money_nonneg segue NOT VALID: linha historica viola (%).', sqlerrm;
end $$;

do $$ begin
  alter table sales validate constraint sales_nfce_env_valid;
exception when check_violation then
  raise warning 'sales_nfce_env_valid segue NOT VALID: linha historica viola (%).', sqlerrm;
end $$;

do $$ begin
  create extension if not exists pg_stat_statements;
exception when others then
  raise warning 'pg_stat_statements indisponivel neste backend (%). Seguindo sem telemetria de query.', sqlerrm;
end $$;
