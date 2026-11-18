import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Run, RunTransaction, Sql } from "../db.ts";

// Evita o bootstrap automatico de PGlite (migrations via `import.meta.glob`,
// so funciona sob Vite) ao importar `../db.ts` fora dele: flipando
// `dbSource` pra "neon" o bloco de boot no fim do arquivo nem roda. Nenhuma
// conexao real acontece -- este teste nunca chama `getSql()`, so
// `getTenantSql`, que e puramente sincrona e so depende do `Sql` que a
// gente mesmo monta aqui em cima de uma instancia PGlite isolada.
process.env.DATABASE_URL ??= "postgres://unused-for-rls-mechanism-test/db";
const { getTenantSql } = await import("../db.ts");

/**
 * `Sql` minimo em cima de uma instancia PGlite crua (sem o schema do app,
 * sem migrations) -- so o suficiente pra `getTenantSql` ter o que embrulhar.
 * Mesmo formato do `toSql`/wrapper interno de `db.ts`, duplicado aqui de
 * proposito: e scaffolding de teste, nao logica de produto.
 */
function wrapPglite(pg: PGlite): Sql {
  function build(run: Run, transaction: RunTransaction): Sql {
    const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      let text = strings[0];
      for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
      return run(text, values);
    }) as unknown as Sql;
    sql.query = (text: string, params: unknown[] = []) => run(text, params);
    sql.transaction = transaction;
    return sql;
  }
  const run: Run = async (text, params) => {
    const res = await pg.query(text, params);
    return res.rows as never[];
  };
  const transaction: RunTransaction = (fn) =>
    pg.transaction(async (t) => {
      const txSql: Sql = build(
        async (text, params) => (await t.query(text, params)).rows as never[],
        (inner) => inner(txSql),
      );
      return fn(txSql);
    }) as ReturnType<typeof fn>;
  return build(run, transaction);
}

describe("getTenantSql (isolamento multi-tenant via RLS)", () => {
  let pg: PGlite;
  let sql: Sql;

  before(async () => {
    pg = new PGlite();
    sql = wrapPglite(pg);

    await pg.query(`
      create table rls_probe (
        id serial primary key,
        company_id int not null,
        label text not null
      )
    `);
    await pg.query(`insert into rls_probe (company_id, label) values (1, 'empresa-1'), (2, 'empresa-2')`);

    await pg.query(`alter table rls_probe enable row level security`);
    await pg.query(`
      create policy tenant_isolation on rls_probe
        using (company_id = current_setting('app.company_id', true)::int)
        with check (company_id = current_setting('app.company_id', true)::int)
    `);

    // Role de teste, sem superusuario/posse da tabela -- dono e superusuario
    // SEMPRE ignoram RLS (e exatamente o bug que derrubaria este teste se a
    // conexao padrao do PGlite, que e superusuario, fosse usada direto: a
    // policy "passaria" sem nunca ser avaliada de verdade).
    await pg.query(`create role probe_role`);
    await pg.query(`grant select, insert, update, delete on rls_probe to probe_role`);
    await pg.query(`grant usage, select on all sequences in schema public to probe_role`);
    await pg.query(`set role probe_role`);
  });

  after(async () => {
    await pg.close();
  });

  it("chamada solta: cada empresa so enxerga a propria linha", async () => {
    const sqlA = getTenantSql(sql, 1);
    const sqlB = getTenantSql(sql, 2);

    const rowsA = await sqlA.query<{ company_id: number; label: string }>(
      "select company_id, label from rls_probe order by id",
    );
    const rowsB = await sqlB.query<{ company_id: number; label: string }>(
      "select company_id, label from rls_probe order by id",
    );

    assert.deepEqual(
      rowsA.map((r) => r.label),
      ["empresa-1"],
    );
    assert.deepEqual(
      rowsB.map((r) => r.label),
      ["empresa-2"],
    );
  });

  it("dentro de .transaction(): a mesma GUC vale pra toda instrucao da transacao", async () => {
    const sqlA = getTenantSql(sql, 1);

    const [countOwn, countOther] = await sqlA.transaction(async (tx) => {
      const own = await tx.query<{ n: number }>("select count(*)::int as n from rls_probe where company_id = 1");
      const other = await tx.query<{ n: number }>("select count(*)::int as n from rls_probe where company_id = 2");
      return [own[0]!.n, other[0]!.n];
    });

    assert.equal(countOwn, 1);
    assert.equal(countOther, 0); // existe na tabela, mas invisivel pra quem esta escopado em 1
  });

  it("WITH CHECK: nao deixa escrever uma linha de outra empresa", async () => {
    const sqlA = getTenantSql(sql, 1);

    await assert.rejects(() =>
      sqlA.query("insert into rls_probe (company_id, label) values (2, 'invasao')"),
    );

    const rows = await sqlA.query<{ n: number }>("select count(*)::int as n from rls_probe where label = 'invasao'");
    assert.equal(rows[0]!.n, 0);
  });
});
