import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, pageRangeLabel, parsePaging } from "./paging.ts";

describe("parsePaging", () => {
  it("usa o padrão quando nada é informado", () => {
    assert.deepEqual(parsePaging({}), { limit: DEFAULT_PAGE_SIZE, offset: 0 });
  });

  it("recorta limite fora da faixa em vez de recusar", () => {
    assert.equal(parsePaging({ limit: 5000 }).limit, MAX_PAGE_SIZE);
    assert.equal(parsePaging({ limit: 0 }).limit, 1);
    assert.equal(parsePaging({ limit: -3 }).limit, 1);
  });

  it("trunca fração", () => {
    assert.deepEqual(parsePaging({ limit: 10.9, offset: 20.9 }), { limit: 10, offset: 20 });
  });

  it("offset negativo vira zero e offset absurdo é limitado", () => {
    assert.equal(parsePaging({ offset: -50 }).offset, 0);
    assert.equal(parsePaging({ offset: 9e15 }).offset, 1_000_000);
  });

  it("recusa lixo em vez de mandar NaN pro SQL", () => {
    assert.throws(() => parsePaging({ limit: Number.NaN }), /Limite inválido\./);
    assert.throws(() => parsePaging({ limit: "10" }), /Limite inválido\./);
    assert.throws(() => parsePaging({ offset: Number.POSITIVE_INFINITY }), /Posição inválida\./);
  });

  it("respeita máximo e padrão próprios", () => {
    assert.equal(parsePaging({ limit: 50 }, { maxLimit: 20 }).limit, 20);
    assert.equal(parsePaging({}, { defaultLimit: 8, maxLimit: 20 }).limit, 8);
    assert.equal(parsePaging({}, { defaultLimit: 500, maxLimit: 20 }).limit, 20);
  });
});

describe("pageRangeLabel", () => {
  it("descreve a janela mostrada", () => {
    assert.equal(pageRangeLabel(0, 100, 250), "1–100 de 250");
    assert.equal(pageRangeLabel(200, 50, 250), "201–250 de 250");
  });

  it("fica vazio sem resultado", () => {
    assert.equal(pageRangeLabel(0, 0, 0), "");
  });
});
