/**
 * Data (YYYY-MM-DD) no fuso LOCAL.
 *
 * `new Date().toISOString().slice(0, 10)` da o dia em UTC: no Brasil (UTC-3)
 * isso vira AMANHA das 21h a meia-noite, todo dia. A loja fecha exatamente
 * nesse horario -- e era quando o painel mostrava "Faturamento hoje R$ 0,00",
 * a despesa da comissao paga caia no dia seguinte (no mes seguinte, no
 * ultimo dia), o crediario vencia um dia depois e a promocao do PDV
 * discordava da do servidor (o banco usa America/Sao_Paulo).
 *
 * Servidor e navegador da loja rodam no fuso da loja, entao os getters
 * locais dao o dia certo nos dois.
 */
export function ymdLocal(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
