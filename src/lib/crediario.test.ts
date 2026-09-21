import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkCreditLimit,
  parseCrediarioInstallments,
  splitCrediario,
  MAX_CREDIARIO_INSTALLMENTS,
} from "./crediario.ts";
import { splitInstallments } from "./installments.ts";

const venda = new Date("2026-09-21T10:00:00-03:00");

describe("splitCrediario", () => {
  it("parcela mensal, primeira pro mes que vem", () => {
    const p = splitCrediario(300, 3, venda);
    assert.deepEqual(
      p.map((x) => x.dueDate),
      ["2026-10-21", "2026-11-20", "2026-12-20"],
    );
    assert.deepEqual(p.map((x) => x.amount), [100, 100, 100]);
  });

  it("a soma fecha EXATAMENTE com a venda", () => {
    // 100 / 3 nao divide redondo -- e onde some ou sobra centavo.
    const p = splitCrediario(100, 3, venda);
    assert.equal(Number(p.reduce((a, x) => a + x.amount, 0).toFixed(2)), 100);
    // A sobra fica na PRIMEIRA: o carne sai com N-1 parcelas redondas.
    assert.deepEqual(p.map((x) => x.amount), [33.34, 33.33, 33.33]);
  });

  it("uma parcela devolve a venda inteira", () => {
    const p = splitCrediario(249.9, 1, venda);
    assert.equal(p.length, 1);
    assert.equal(p[0]!.amount, 249.9);
    assert.equal(p[0]!.dueDate, "2026-10-21");
  });

  it("fecha exato tambem em valor quebrado e muitas parcelas", () => {
    for (const total of [0.01, 9.99, 1234.57, 87.45]) {
      for (const n of [2, 3, 6, 7, 12]) {
        const soma = splitCrediario(total, n, venda).reduce((a, x) => a + x.amount, 0);
        assert.equal(Number(soma.toFixed(2)), total, `${total} em ${n}x`);
      }
    }
  });
});

describe("parseCrediarioInstallments", () => {
  it("aceita de 1 ao teto", () => {
    assert.equal(parseCrediarioInstallments(1), 1);
    assert.equal(parseCrediarioInstallments(MAX_CREDIARIO_INSTALLMENTS), MAX_CREDIARIO_INSTALLMENTS);
    assert.equal(parseCrediarioInstallments(undefined), 1);
    assert.equal(parseCrediarioInstallments(""), 1);
  });

  it("recusa o que nao e parcela", () => {
    assert.throws(() => parseCrediarioInstallments(0), /inválido/);
    assert.throws(() => parseCrediarioInstallments(-1), /inválido/);
    assert.throws(() => parseCrediarioInstallments(2.5), /inválido/);
    assert.throws(() => parseCrediarioInstallments(Number.NaN), /inválido/);
    assert.throws(() => parseCrediarioInstallments("abc"), /inválido/);
  });

  it("tem teto", () => {
    assert.throws(() => parseCrediarioInstallments(24), /no máximo/);
  });
});

describe("checkCreditLimit", () => {
  it("aprova quando cabe no limite", () => {
    const r = checkCreditLimit({ limite: 1000, emAberto: 200, novo: 300 });
    assert.equal(r.ok, true);
    assert.equal(r.disponivel, 800);
  });

  it("recusa quando estoura, dizendo quanto ainda cabe", () => {
    const r = checkCreditLimit({ limite: 500, emAberto: 300, novo: 400 });
    assert.equal(r.ok, false);
    assert.match(r.ok === false ? r.motivo : "", /Disponível/);
    assert.match(r.ok === false ? r.motivo : "", /R\$\s*200,00/);
  });

  it("recusa com mensagem propria quando nao ha nada disponivel", () => {
    const r = checkCreditLimit({ limite: 500, emAberto: 500, novo: 10 });
    assert.equal(r.ok, false);
    assert.match(r.ok === false ? r.motivo : "", /sem limite disponível/);
  });

  it("limite ZERO significa nao configurado, nao credito zero", () => {
    // Tratar 0 como bloqueio impediria crediario em toda loja que nunca
    // preencheu o campo -- quebrar o que funciona pra estrear um controle.
    const r = checkCreditLimit({ limite: 0, emAberto: 9999, novo: 9999 });
    assert.equal(r.ok, true);
  });

  it("tolera um centavo de arredondamento", () => {
    assert.equal(checkCreditLimit({ limite: 500, emAberto: 499.995, novo: 0 }).ok, true);
    assert.equal(checkCreditLimit({ limite: 500, emAberto: 500, novo: 0.5 }).ok, false);
  });

  it("aceita exatamente o limite", () => {
    assert.equal(checkCreditLimit({ limite: 500, emAberto: 200, novo: 300 }).ok, true);
  });
});

describe("splitInstallments (regra compartilhada com o cartao)", () => {
  it("respeita passo diferente de 30 dias", () => {
    const p = splitInstallments({ total: 90, count: 3, firstDueInDays: 7, stepDays: 7, from: venda });
    assert.deepEqual(p.map((x) => x.dueDate), ["2026-09-28", "2026-10-05", "2026-10-12"]);
  });

  it("count menor que 1 vira 1 em vez de quebrar", () => {
    const p = splitInstallments({ total: 50, count: 0, firstDueInDays: 30, from: venda });
    assert.equal(p.length, 1);
    assert.equal(p[0]!.amount, 50);
  });
});
