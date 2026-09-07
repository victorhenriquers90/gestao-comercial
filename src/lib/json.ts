export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };

export type Row = { [key: string]: Json };

/** JSON-safe copy that preserves the caller's type. */
export function dump<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
