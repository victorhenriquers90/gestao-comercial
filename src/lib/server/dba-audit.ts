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
      table: string;
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
        relname as table,
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
      table: string;
      index: string;
      size: string;
      idx_scan: number;
      is_unique: boolean;
    }>`
      select
        sui.relname as table, sui.indexrelname as index,
        pg_size_pretty(pg_relation_size(sui.indexrelid)) as size,
        sui.idx_scan,
        ix.indisunique as is_unique
      from pg_stat_user_indexes sui
      join pg_index ix on ix.indexrelid = sui.indexrelid
      where sui.idx_scan = 0
      order by pg_relation_size(sui.indexrelid) desc
      limit 40
    `;

    const missingFkIndexes = await sql<{ table: string; column: string; fk_name: string }>`
      select distinct
        con.conrelid::regclass::text as table,
        a.attname as column,
        con.conname as fk_name
      from pg_constraint con
      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = any(con.conkey)
      where con.contype = 'f'
        and not exists (
          select 1 from pg_index i
          where i.indrelid = con.conrelid and i.indkey[0] = a.attnum
        )
      order by table, column
    `;

    const tenantTablesWithoutIndex = await sql<{ table: string }>`
      select distinct c.relname as table
      from pg_class c
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'company_id'
      where c.relkind = 'r' and c.relnamespace = 'public'::regnamespace
        and not exists (
          select 1 from pg_index i
          where i.indrelid = c.oid and i.indkey[0] = a.attnum
        )
      order by table
    `;

    const duplicateIndexes = await sql<{ table: string; indexes: string[] }>`
      select indrelid::regclass::text as table, array_agg(indexrelid::regclass::text) as indexes
      from pg_index
      group by indrelid, indkey, indclass
      having count(*) > 1
    `;

    const notValidConstraints = await sql<{ table: string; constraint: string }>`
      select conrelid::regclass::text as table, conname as constraint
      from pg_constraint
      where contype = 'c' and not convalidated
      order by table
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

    const publicGrants = await sql<{ table: string; privilege: string }>`
      select table_name as table, privilege_type as privilege
      from information_schema.table_privileges
      where grantee = 'PUBLIC' and table_schema = 'public'
      order by table, privilege
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
    };
  });
