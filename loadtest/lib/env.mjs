import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Parser de .env minimo (sem dependencia nova): so KEY=VALUE por linha,
 * ignora comentario e linha vazia. loadtest/.env nunca vai pro git
 * (.gitignore ja cobre `.env*` na raiz do projeto).
 */
export async function loadLocalEnv() {
  const dir = dirname(fileURLToPath(import.meta.url));
  const path = join(dir, "..", ".env");
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
