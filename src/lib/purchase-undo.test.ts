import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PURCHASE_UNDO_RECEIVE_WINDOW_MINUTES, checkUndoReceiveWindow } from "./purchase-undo.ts";

describe("checkUndoReceiveWindow", () => {
  const recebido = "2026-09-22T10:00:00-03:00";

  it("recém-recebido pode desfazer, com a janela inteira restante", () => {
    const w = checkUndoReceiveWindow(recebido, new Date("2026-09-22T10:00:00-03:00"));
    assert.equal(w.ok, true);
    assert.equal(w.minutosRestantes, PURCHASE_UNDO_RECEIVE_WINDOW_MINUTES);
  });

  it("conta o tempo decorrido dentro da janela", () => {
    const w = checkUndoReceiveWindow(recebido, new Date("2026-09-22T10:20:00-03:00"));
    assert.equal(w.ok, true);
    assert.equal(w.minutosDecorridos, 20);
    assert.equal(w.minutosRestantes, 10);
  });

  it("passado o prazo, BLOQUEIA -- ao contrário do cancelamento de NFC-e, não há SEFAZ pra decidir aqui", () => {
    const w = checkUndoReceiveWindow(recebido, new Date("2026-09-22T10:45:00-03:00"));
    assert.equal(w.ok, false);
    assert.equal(w.minutosRestantes, 0);
    assert.match(w.motivo ?? "", /prazo de 30 minutos/);
    assert.match(w.motivo ?? "", /Ajuste o estoque manualmente/);
  });

  it("exatamente no limite conta como expirado", () => {
    const w = checkUndoReceiveWindow(recebido, new Date("2026-09-22T10:30:00-03:00"));
    assert.equal(w.ok, false);
  });

  it("um segundo antes do limite ainda passa", () => {
    const w = checkUndoReceiveWindow(recebido, new Date("2026-09-22T10:29:59-03:00"));
    assert.equal(w.ok, true);
    assert.equal(w.minutosRestantes, 1);
  });

  it("data ilegível recusa, não deixa tentar", () => {
    // Diferente do cancelWindow da NFC-e (onde "na duvida, deixa tentar" e
    // seguro porque o SEFAZ e quem decide de verdade): aqui nao ha segunda
    // trava externa -- se a data nao faz sentido, bloquear e o lado seguro.
    const w = checkUndoReceiveWindow("data errada", new Date("2026-09-22T10:00:00-03:00"));
    assert.equal(w.ok, false);
  });

  it("sem data de recebimento, recusa", () => {
    assert.equal(checkUndoReceiveWindow(null).ok, false);
    assert.equal(checkUndoReceiveWindow(undefined).ok, false);
  });

  it("relógio atrasado não gera tempo negativo nem libera além da janela", () => {
    const w = checkUndoReceiveWindow(recebido, new Date("2026-09-22T09:00:00-03:00"));
    assert.equal(w.minutosDecorridos, 0);
    assert.equal(w.minutosRestantes, PURCHASE_UNDO_RECEIVE_WINDOW_MINUTES);
  });
});
