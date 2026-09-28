import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolvePeriod } from "./period.ts";

describe("resolvePeriod", () => {
  it("período anterior tem o MESMO número de dias que o período atual", () => {
    // Bug real: `end` é fim de dia (23:59:59.999), e a contagem de dias
    // somava um "+1" pensado pra fronteiras meia-noite-a-meia-noite --
    // "ontem" (1 dia) calculava um período anterior de 2 dias, inflando a
    // base do "vs período anterior" do Dashboard pra todo período.
    for (const key of ["today", "yesterday", "7d", "30d"] as const) {
      const r = resolvePeriod(key);
      const dias = (a: string, b: string) =>
        Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86400000) + 1;
      assert.equal(dias(r.prevFrom, r.prevTo), dias(r.from, r.to), `período anterior de "${key}" com tamanho diferente`);
    }
  });

  it("'ontem' compara contra o dia anterior a ontem, não dois dias antes", () => {
    const r = resolvePeriod("yesterday");
    const ontem = new Date(`${r.from}T00:00:00`);
    const anteontem = new Date(ontem.getTime() - 86400000);
    const esperado = anteontem.toISOString().slice(0, 10);
    assert.equal(r.prevFrom, esperado);
    assert.equal(r.prevTo, esperado);
  });

  it("mês atual compara contra o mesmo número de dias do mês anterior, não um a mais", () => {
    const r = resolvePeriod("month");
    const diasDoMes = Math.round(
      (new Date(`${r.to}T00:00:00`).getTime() - new Date(`${r.from}T00:00:00`).getTime()) / 86400000,
    ) + 1;
    const diasDoAnterior = Math.round(
      (new Date(`${r.prevTo}T00:00:00`).getTime() - new Date(`${r.prevFrom}T00:00:00`).getTime()) / 86400000,
    ) + 1;
    assert.equal(diasDoAnterior, diasDoMes);
  });
});
