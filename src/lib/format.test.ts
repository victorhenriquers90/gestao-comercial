import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPhone } from "./format.ts";

describe("formatPhone", () => {
  it("celular com DDD", () => {
    assert.equal(formatPhone("11982223344"), "(11) 98222-3344");
  });

  it("fixo com DDD", () => {
    assert.equal(formatPhone("1130904000"), "(11) 3090-4000");
  });

  it("sem DDD", () => {
    assert.equal(formatPhone("982223344"), "98222-3344");
    assert.equal(formatPhone("30904000"), "3090-4000");
  });

  it("ignora o que ja vem formatado e reformata", () => {
    assert.equal(formatPhone("(11) 98222-3344"), "(11) 98222-3344");
    assert.equal(formatPhone("+55 11 98222-3344"), "+55 11 98222-3344");
  });

  it("formato desconhecido volta como veio, sem inventar separador", () => {
    assert.equal(formatPhone("123"), "123");
    assert.equal(formatPhone("ramal 42"), "ramal 42");
  });

  it("vazio e nulo nao quebram", () => {
    assert.equal(formatPhone(""), "");
    assert.equal(formatPhone(null), "");
    assert.equal(formatPhone(undefined), "");
  });
});
