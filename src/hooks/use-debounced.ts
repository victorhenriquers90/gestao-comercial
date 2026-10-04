import { useEffect, useState } from "react";

/** Valor que só muda depois de `ms` sem novas alterações (busca digitada → consulta). */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}
