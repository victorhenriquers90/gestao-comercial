export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type Row = { [key: string]: Json };

/**
 * Round-trip por JSON.stringify/parse -- o `T` do retorno e o do CHAMADOR,
 * nao uma garantia do runtime: BigInt/Date/undefined/NaN/Infinity mudam de
 * forma na volta (undefined some, Date vira string, etc.), mesmo com o tipo
 * dizendo que continuam iguais. Seguro hoje porque `db.ts` ja normaliza
 * int8/bigint pra number e date pra string 'YYYY-MM-DD' na camada do driver
 * -- nada desse tipo chega aqui cru -- mas se um campo novo algum dia trouxer
 * um Date/BigInt de verdade, o tipo nao vai avisar.
 */
export function dump<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
