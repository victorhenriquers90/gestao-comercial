import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CANCEL_REASON_MIN,
  NFCE_CANCEL_WINDOW_MINUTES,
  cancelWindow,
  parseCancelReason,
  pendenciaText,
} from "./nfce-cancel.ts";

describe("parseCancelReason", () => {
  it("aceita uma justificativa de verdade", () => {
    assert.equal(
      parseCancelReason("Cliente desistiu da compra no balcão."),
      "Cliente desistiu da compra no balcão.",
    );
  });

  it("recusa o motivo curto que se usaria pra cancelar a venda", () => {
    // O minimo de 15 e regra do SEFAZ. "Desistiu" tem 8: reaproveitar o
    // motivo do cancelamento da venda daria recusa na hora do envio.
    assert.throws(() => parseCancelReason("Desistiu"), /pelo menos 15 caracteres \(tem 8\)/);
    assert.throws(() => parseCancelReason(""), /tem 0/);
    assert.throws(() => parseCancelReason(null), /tem 0/);
  });

  it("espaço em excesso não vira tamanho", () => {
    // Senao "ok" + 20 espacos passaria como justificativa fiscal.
    assert.throws(() => parseCancelReason("ok                        "), /tem 2/);
    assert.equal(parseCancelReason("Erro   de    digitação no item"), "Erro de digitação no item");
  });

  it("corta no máximo do SEFAZ em vez de deixar o envio falhar", () => {
    const longa = "a".repeat(400);
    assert.equal(parseCancelReason(longa).length, 255);
  });

  it("exatamente no mínimo passa", () => {
    const exato = "a".repeat(CANCEL_REASON_MIN);
    assert.equal(parseCancelReason(exato).length, CANCEL_REASON_MIN);
  });
});

describe("cancelWindow", () => {
  const emitida = "2026-09-22T10:00:00-03:00";

  it("recém-emitida tem a janela inteira", () => {
    const w = cancelWindow(emitida, new Date("2026-09-22T10:00:00-03:00"));
    assert.equal(w.minutosRestantes, NFCE_CANCEL_WINDOW_MINUTES);
    assert.equal(w.provavelmenteExpirado, false);
  });

  it("conta o tempo decorrido", () => {
    const w = cancelWindow(emitida, new Date("2026-09-22T10:20:00-03:00"));
    assert.equal(w.minutosDecorridos, 20);
    assert.equal(w.minutosRestantes, 10);
    assert.equal(w.provavelmenteExpirado, false);
  });

  it("passado o prazo, avisa — e o aviso é só aviso", () => {
    // Quem decide se ainda dá tempo é o SEFAZ: estados podem ser mais
    // restritos que o teto, e uma recusa deles com motivo vale mais que uma
    // recusa nossa baseada num prazo que talvez não valha aqui.
    const w = cancelWindow(emitida, new Date("2026-09-22T10:45:00-03:00"));
    assert.equal(w.provavelmenteExpirado, true);
    assert.equal(w.minutosRestantes, 0);
  });

  it("data ilegível não vira 'expirado' por acidente", () => {
    // Expirado é o lado que ESCONDE o botão. Na dúvida, deixa tentar.
    const w = cancelWindow("data errada", new Date("2026-09-22T10:45:00-03:00"));
    assert.equal(w.provavelmenteExpirado, false);
    assert.equal(w.minutosRestantes, NFCE_CANCEL_WINDOW_MINUTES);
  });

  it("sem data de autorização, deixa tentar", () => {
    assert.equal(cancelWindow(null).provavelmenteExpirado, false);
  });

  it("relógio atrasado não gera tempo negativo", () => {
    const w = cancelWindow(emitida, new Date("2026-09-22T09:00:00-03:00"));
    assert.equal(w.minutosDecorridos, 0);
  });
});

describe("pendenciaText", () => {
  it("diz o que ficou torto e qual é o próximo passo", () => {
    const t = pendenciaText("fora_do_prazo");
    assert.match(t, /continua autorizada/);
    assert.match(t, /NF-e de devolução/);
    assert.match(t, /este sistema não emite/);
  });

  it("devolução parcial não promete cancelamento", () => {
    // A venda aconteceu, só que menor -- cancelar a nota seria errado.
    const t = pendenciaText("devolucao_parcial");
    assert.match(t, /Cancelar a nota não serve/);
  });

  it("falha de cancelamento sugere tentar de novo", () => {
    assert.match(pendenciaText("cancelamento_falhou"), /Tente cancelar de novo/);
  });

  it("carrega o retorno do SEFAZ quando existe", () => {
    const t = pendenciaText("cancelamento_falhou", "Rejeicao: prazo esgotado");
    assert.match(t, /Retorno do SEFAZ: Rejeicao: prazo esgotado/);
  });
});
