import type { Sql } from "@/lib/db";
import { num } from "@/lib/utils";

export async function applyStockChange(
  sql: Sql,
  args: {
    companyId: number;
    storeId: number;
    variantId: number;
    delta: number;
    type: string;
    userId: string;
    note?: string | null;
    referenceType?: string | null;
    referenceId?: number | null;
    allowNegative?: boolean;
  },
): Promise<{ previous: number; next: number }> {
  // Guarda no funil por onde TODA movimentacao de estoque passa.
  //
  // A guarda que existia embaixo -- `quantity + delta >= 0` -- nao segura
  // um delta NaN: no Postgres `'NaN'::numeric >= 0` e VERDADEIRO (NaN conta
  // como maior que qualquer numero), entao o update passava e gravava
  // `quantity = NaN`. Dali em diante o estoque daquele produto fica NaN pra
  // sempre, junto com todo relatorio e alerta que o soma -- e nao da pra
  // desfazer pela tela. Verificado contra o Postgres da loja: um NaN do
  // JavaScript atravessa o driver intacto e passa na comparacao.
  //
  // Fica aqui, e nao so em quem chama, porque a proxima funcao que mexer em
  // estoque vai passar por este ponto sem precisar lembrar disto.
  if (!Number.isFinite(args.delta)) {
    throw new Error("Movimentação de estoque com quantidade inválida.");
  }

  await sql.query(
    `insert into inventories (company_id, store_id, variant_id, quantity)
     values ($1, $2, $3, 0)
     on conflict (store_id, variant_id) do nothing`,
    [args.companyId, args.storeId, args.variantId],
  );

  const rows = await sql.query<{ previous: string | number; next: string | number }>(
    `with u as (
       update inventories
          set quantity = quantity + $1::numeric,
              updated_at = now()
        where company_id = $2
          and store_id = $3
          and variant_id = $4
          and ($5::boolean or quantity + $1::numeric >= 0)
       returning (quantity - $1::numeric) as previous, quantity as next
     )
     insert into stock_movements (
       company_id, store_id, variant_id, quantity, previous_qty, new_qty,
       type, user_id, note, reference_type, reference_id
     )
     select $2, $3, $4, $1::numeric, previous, next, $6, $7, $8, $9, $10
       from u
     returning previous_qty as previous, new_qty as next`,
    [
      args.delta,
      args.companyId,
      args.storeId,
      args.variantId,
      Boolean(args.allowNegative),
      args.type,
      args.userId,
      args.note ?? null,
      args.referenceType ?? null,
      args.referenceId ?? null,
    ],
  );

  if (!rows.length) {
    throw new Error("Estoque insuficiente para esta movimentação.");
  }
  return { previous: num(rows[0]!.previous), next: num(rows[0]!.next) };
}
