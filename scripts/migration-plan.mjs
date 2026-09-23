// @ts-check
/**
 * Migration bookkeeping shared by the two appliers — `scripts/migrate.mjs`
 * (deploy, `readdir`) and `src/lib/db.ts` (PGLite preview, `import.meta.glob`).
 *
 * Applied files are keyed by BASENAME, so the same file applies once no matter
 * which directory it is globbed from. That is what makes the auth schema safe to
 * copy from `migrations/auth/` into `migrations/` when an app turns sign-in on:
 * a database that already has `0001_auth.sql` will not re-run it.
 *
 * Neither applier descends into subdirectories, so `migrations/auth/*.sql` is
 * out of scope for both until it is copied up.
 */

/**
 * The `_migrations` key for a migration path (or bare filename).
 * @param {string} path
 * @returns {string}
 */
export function migrationName(path) {
  return path.split("/").pop() ?? path;
}

/**
 * @param {string} path
 * @returns {boolean}
 */
export function isMigrationFile(path) {
  return path.endsWith(".sql");
}

/**
 * Migrations in `paths` that are not yet in `applied`, in apply order.
 * Non-`.sql` entries (a `readdir` also yields `migrations/auth/`) are dropped.
 * @param {Iterable<string>} paths
 * @param {Iterable<string>} applied
 * @returns {Array<{ name: string, path: string }>}
 */
export function pendingMigrations(paths, applied) {
  const done = new Set(applied);
  return [...paths]
    .filter(isMigrationFile)
    .map((path) => ({ name: migrationName(path), path }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter(({ name }) => !done.has(name));
}

/**
 * Migrations registradas no banco cujo ARQUIVO nao existe mais.
 *
 * O contrario de `pendingMigrations`, e a direcao que ninguem olhava. Na loja
 * piloto isso deixou passar um desvio de schema por onze dias: uma migration
 * `0022_nfce_foundation.sql` rodou em 11/09/2026, criou duas tabelas, e depois
 * foi APAGADA do repositorio e substituida por outra com o mesmo numero
 * (`0022_nfce.sql`). O banco da loja ficou com 47 tabelas e uma instalacao
 * nova de hoje teria 45 -- producao e cliente novo com schemas diferentes, o
 * que faz qualquer diagnostico futuro comecar errado.
 *
 * Nao e erro fatal de proposito: uma migration antiga legitimamente removida
 * (consolidada noutra, por exemplo) nao pode travar o deploy de uma loja que
 * ja rodou aquilo. E aviso -- mas aviso que APARECE, que e o que faltava.
 *
 * @param {Iterable<string>} paths arquivos em disco
 * @param {Iterable<string>} applied nomes registrados em `_migrations`
 * @returns {string[]} nomes aplicados sem arquivo, em ordem
 */
export function orphanMigrations(paths, applied) {
  const emDisco = new Set(
    [...paths].filter(isMigrationFile).map((path) => migrationName(path)),
  );
  return [...applied].filter((name) => !emDisco.has(name)).sort((a, b) => a.localeCompare(b));
}
