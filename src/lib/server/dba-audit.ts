/**
 * Diagnostico de DBA -- TEMPORARIO. Criado so pra rodar a auditoria pedida
 * (saude geral, performance, integridade, seguranca) e sera removido junto
 * com a rota /app/dba-audit depois do relatorio. So leitura: nenhuma query
 * aqui grava, altera schema ou mexe em dado de negocio.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { assertCan } from "@/lib/permissions";
import { requireTenant } from "./context";

export const dbaAuditFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "settings.write");

    const [env] = await sql<{ version: string; database: string; app_role: string }>`
      select version() as version, current_database() as database, current_user as app_role
    `;
    const [size] = await sql<{ db_size: string }>`
      select pg_size_pretty(pg_database_size(current_database())) as db_size
    `;

    const tableStats = await sql<{
      table_name: string;
      total_size: string;
      total_bytes: number;
      live_rows: number;
      dead_rows: number;
      dead_pct: number;
      seq_scan: number;
      idx_scan: number;
      seq_scan_pct: number;
      last_autovacuum: string | null;
      last_autoanalyze: string | null;
    }>`
      select
        relname as table_name,
        pg_size_pretty(pg_total_relation_size(relid)) as total_size,
        pg_total_relation_size(relid) as total_bytes,
        n_live_tup as live_rows,
        n_dead_tup as dead_rows,
        case when n_live_tup > 0 then round(100.0 * n_dead_tup / n_live_tup, 1) else 0 end as dead_pct,
        seq_scan, idx_scan,
        case when (seq_scan + idx_scan) > 0 then round(100.0 * seq_scan / (seq_scan + idx_scan), 1) else 0 end as seq_scan_pct,
        last_autovacuum, last_autoanalyze
      from pg_stat_user_tables
      order by pg_total_relation_size(relid) desc
      limit 25
    `;

    const unusedIndexes = await sql<{
      table_name: string;
      index_name: string;
      size: string;
      idx_scan: number;
      is_unique: boolean;
    }>`
      select
        sui.relname as table_name, sui.indexrelname as index_name,
        pg_size_pretty(pg_relation_size(sui.indexrelid)) as size,
        sui.idx_scan,
        ix.indisunique as is_unique
      from pg_stat_user_indexes sui
      join pg_index ix on ix.indexrelid = sui.indexrelid
      where sui.idx_scan = 0
      order by pg_relation_size(sui.indexrelid) desc
      limit 40
    `;

    const missingFkIndexes = await sql<{ table_name: string; column_name: string; fk_name: string }>`
      select distinct
        con.conrelid::regclass::text as table_name,
        a.attname as column_name,
        con.conname as fk_name
      from pg_constraint con
      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = any(con.conkey)
      where con.contype = 'f'
        and not exists (
          select 1 from pg_index i
          where i.indrelid = con.conrelid and i.indkey[0] = a.attnum
        )
      order by table_name, column_name
    `;

    const tenantTablesWithoutIndex = await sql<{ table_name: string }>`
      select distinct c.relname as table_name
      from pg_class c
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'company_id'
      where c.relkind = 'r' and c.relnamespace = 'public'::regnamespace
        and not exists (
          select 1 from pg_index i
          where i.indrelid = c.oid and i.indkey[0] = a.attnum
        )
      order by table_name
    `;

    const duplicateIndexes = await sql<{ table_name: string; indexes: string[] }>`
      select indrelid::regclass::text as table_name, array_agg(indexrelid::regclass::text) as indexes
      from pg_index
      group by indrelid, indkey, indclass
      having count(*) > 1
    `;

    const notValidConstraints = await sql<{ table_name: string; constraint_name: string }>`
      select conrelid::regclass::text as table_name, conname as constraint_name
      from pg_constraint
      where contype = 'c' and not convalidated
      order by table_name
    `;

    const connectionStats = await sql<{ state: string | null; count: number }>`
      select state, count(*)::int as count
      from pg_stat_activity
      where datname = current_database()
      group by state
      order by count desc
    `;

    const [roleInfo] = await sql<{
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolreplication: boolean;
      rolbypassrls: boolean;
    }>`
      select rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
      from pg_roles where rolname = current_user
    `;

    const publicGrants = await sql<{ table_name: string; privilege: string }>`
      select table_name, privilege_type as privilege
      from information_schema.table_privileges
      where grantee = 'PUBLIC' and table_schema = 'public'
      order by table_name, privilege
    `;

    type SlowQuery = {
      query: string;
      calls: number;
      mean_ms: string | number;
      total_ms: string | number;
      rows: number;
    };
    let hasPgStatStatements = false;
    let slowQueries: SlowQuery[] = [];
    try {
      const [ext] = await sql<{ present: boolean }>`
        select exists(select 1 from pg_extension where extname = 'pg_stat_statements') as present
      `;
      hasPgStatStatements = ext?.present ?? false;
      if (hasPgStatStatements) {
        slowQueries = await sql<SlowQuery>`
          select left(query, 200) as query, calls,
                 round(mean_exec_time::numeric, 2) as mean_ms,
                 round(total_exec_time::numeric, 2) as total_ms,
                 rows
          from pg_stat_statements
          where query not ilike '%pg_stat_statements%'
          order by mean_exec_time desc
          limit 15
        `;
      }
    } catch {
      hasPgStatStatements = false;
    }

    const orphanMigrations = await sql<{ name: string; applied_at: string }>`
      select name, applied_at from _migrations order by applied_at desc limit 5
    `;
    const [migrationCount] = await sql<{ n: number }>`select count(*)::int as n from _migrations`;

    // Invariantes de negocio que o schema NAO garante sozinho -- cada um
    // devolve a CONTAGEM de linhas violando (0 = saudavel). Os cinco
    // primeiros sao o teste real de isolamento multi-tenant: company_id de
    // linha filha divergindo do pai.
    const integrity: Record<string, number> = {};
    const checks: Record<string, string> = {
      sale_items_cross_tenant:
        "select count(*)::int as n from sale_items si join sales s on s.id = si.sale_id where si.company_id <> s.company_id",
      payments_cross_tenant:
        "select count(*)::int as n from payments p join sales s on s.id = p.sale_id where p.company_id <> s.company_id",
      receivables_cross_tenant:
        "select count(*)::int as n from accounts_receivable ar join sales s on s.id = ar.sale_id where ar.company_id <> s.company_id",
      variants_cross_tenant:
        "select count(*)::int as n from product_variants v join products p on p.id = v.product_id where v.company_id <> p.company_id",
      inventories_cross_tenant:
        "select count(*)::int as n from inventories i join stores st on st.id = i.store_id where i.company_id <> st.company_id",
      negative_stock: "select count(*)::int as n from inventories where quantity < 0",
      receivable_overpaid:
        "select count(*)::int as n from accounts_receivable where received_amount > amount + 0.009",
      payable_overpaid:
        "select count(*)::int as n from accounts_payable where paid_amount > amount + 0.009",
      sale_payments_mismatch:
        "select count(*)::int as n from sales s where s.status in ('finalizada','devolvida_parcial','devolvida') and abs((select coalesce(sum(p.amount),0) from payments p where p.sale_id = s.id) - s.total) > 0.05",
      sale_items_vs_subtotal:
        "select count(*)::int as n from sales s where s.status <> 'cancelada' and abs((select coalesce(sum(i.total),0) from sale_items i where i.sale_id = s.id) - s.subtotal) > 0.05",
      not_valid_rows_money:
        "select (select count(*)::int from products where cost < 0 or price < 0) + (select count(*)::int from accounts_receivable where amount < 0 or discount < 0 or received_amount < 0) + (select count(*)::int from accounts_payable where amount < 0 or discount < 0 or paid_amount < 0) as n",
    };
    for (const [name, text] of Object.entries(checks)) {
      const [row] = await sql.query<{ n: number }>(text);
      integrity[name] = row?.n ?? -1;
    }

    return {
      env,
      dbSize: size?.db_size,
      tableStats,
      unusedIndexes,
      missingFkIndexes,
      tenantTablesWithoutIndex,
      duplicateIndexes,
      notValidConstraints,
      connectionStats,
      roleInfo,
      publicGrants,
      hasPgStatStatements,
      slowQueries,
      migrationCount: migrationCount?.n,
      recentMigrations: orphanMigrations,
      integrity,
    };
  });
