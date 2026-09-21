import { Input } from "@/components/ui/input";
import { CASH_DENOMINATIONS, parseQty } from "@/lib/cash-count";
import { formatBRL } from "@/lib/format";

export type CountMode = "cedula" | "total";

/**
 * Ficha de contagem da gaveta.
 *
 * O valor conferido sai das CEDULAS, nao de um campo unico. Um campo unico
 * aceita qualquer numero redondo e nao deixa rastro do que foi contado --
 * e um numero redondo e o formato natural de um palpite. Preenchendo a
 * ficha, o total aparece sozinho e fica guardado junto com o fechamento:
 * quem revisa depois ve QUANTAS notas de cinquenta o caixa diz ter contado,
 * nao so um total.
 *
 * O modo "total direto" existe porque muita loja conta no papel e so lanca
 * o resultado. Tirar essa saida nao faria ninguem preencher a ficha -- faria
 * a ficha ser preenchida de qualquer jeito depois de o total ja estar
 * decidido, que e pior: vira ficha falsa com aparencia de prova.
 */
export function CashCountSheet({
  modo,
  onModo,
  qtys,
  onQtys,
  totalDireto,
  onTotalDireto,
  disabled,
}: {
  modo: CountMode;
  onModo: (m: CountMode) => void;
  qtys: Record<string, string>;
  onQtys: (q: Record<string, string>) => void;
  totalDireto: string;
  onTotalDireto: (v: string) => void;
  disabled?: boolean;
}) {
  const notas = CASH_DENOMINATIONS.filter((d) => d.kind === "nota");
  const moedas = CASH_DENOMINATIONS.filter((d) => d.kind === "moeda");

  function linha(cents: number, label: string) {
    const bruto = qtys[String(cents)] ?? "";
    const qty = parseQty(bruto);
    const invalido = !Number.isFinite(qty);
    const sub = invalido ? 0 : (cents * qty) / 100;
    return (
      // `max-w` na LINHA, nao na coluna: sem isso o subtotal era empurrado pro
      // fim de uma coluna larga e ficava a 300px do campo que ele resume --
      // dois numeros na mesma linha que o olho nao liga mais um ao outro.
      <div
        key={cents}
        className="grid max-w-[17rem] grid-cols-[4.5rem_5rem_minmax(0,1fr)] items-center gap-2"
      >
        <span className="text-sm text-muted-foreground">{label}</span>
        <Input
          // Altura padrao do sistema de proposito: `h-9` aqui era CODIGO MORTO
          // (`h-10` da base vence pela ordem das utilities do Tailwind, nao
          // pela ordem no atributo) e 40px e o alvo de toque certo pra quem
          // conta gaveta em pe no balcao.
          className={`text-center ${invalido ? "ring-2 ring-destructive/50" : ""}`}
          inputMode="numeric"
          disabled={disabled}
          placeholder="0"
          aria-label={`Quantidade de ${label}`}
          aria-invalid={invalido || undefined}
          value={bruto}
          onChange={(e) => onQtys({ ...qtys, [String(cents)]: e.target.value })}
        />
        <span className="tabular text-right text-sm text-muted-foreground">
          {qty > 0 && !invalido ? formatBRL(sub) : ""}
        </span>
      </div>
    );
  }

  return (
    <div>
      <div className="flex gap-1 rounded-lg bg-muted p-1" role="group" aria-label="Como contar">
        {(
          [
            ["cedula", "Por cédula"],
            ["total", "Só o total"],
          ] as const
        ).map(([valor, rotulo]) => (
          <button
            key={valor}
            type="button"
            disabled={disabled}
            aria-pressed={modo === valor}
            onClick={() => onModo(valor)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${
              modo === valor ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
            }`}
          >
            {rotulo}
          </button>
        ))}
      </div>

      {modo === "cedula" ? (
        // `split-grid` (auto-fit) e nao `sm:grid-cols-2`: o `sm:` olha a
        // JANELA, e esta ficha vive dentro de um cartao que pode ter metade
        // da largura. Medido no laboratorio a 1280px: com `sm:`, as duas
        // colunas nasciam com 199px e a coluna do subtotal sobrava com 38px
        // -- "R$ 1.100,00" estourava a linha. O auto-fit responde ao cartao.
        <div className="split-grid mt-block">
          <div className="space-y-2">
            <p className="ed-label">Notas</p>
            {notas.map((d) => linha(d.cents, d.label))}
          </div>
          <div className="space-y-2">
            <p className="ed-label">Moedas</p>
            {moedas.map((d) => linha(d.cents, d.label))}
          </div>
        </div>
      ) : (
        <div className="mt-block">
          <label className="grid gap-1.5">
            <span className="ed-label">Total contado na gaveta</span>
            <Input
              inputMode="decimal"
              disabled={disabled}
              placeholder="0,00"
              value={totalDireto}
              onChange={(e) => onTotalDireto(e.target.value)}
            />
          </label>
        </div>
      )}
    </div>
  );
}

