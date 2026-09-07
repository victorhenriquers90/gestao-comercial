import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isValidCnpj, isValidCpf, maskBrDoc, maskCnpj, maskCpf, parseBrDocument, parseCnpj, sellerDocKind } from "./document.ts";

describe("CPF algorithm", () => {
  it("accepts a well-known valid CPF and rejects fakes", () => {
    assert.equal(isValidCpf("529.982.247-25"), true);
    assert.equal(isValidCpf("52998224725"), true);
    assert.equal(isValidCpf("111.111.111-11"), false);
    assert.equal(isValidCpf("12345678900"), false);
    assert.equal(isValidCpf("52998224724"), false);
    assert.equal(isValidCpf(""), false);
  });

  it("accepts a valid CNPJ and rejects same-digit", () => {
    assert.equal(isValidCnpj("11.222.333/0001-81"), true);
    assert.equal(isValidCnpj("11222333000181"), true);
    assert.equal(isValidCnpj("11.111.111/1111-11"), false);
    assert.equal(isValidCnpj("11222333000180"), false);
  });

  it("parses by kind and stores digits", () => {
    assert.equal(parseBrDocument("529.982.247-25", "cpf"), "52998224725");
    assert.equal(parseBrDocument("", "cpf"), null);
    assert.equal(parseBrDocument("   ", "cpf"), null);
    assert.throws(() => parseBrDocument("52998224724", "cpf"), /CPF inválido/);
    assert.throws(() => parseBrDocument("52998224725", "cnpj"), /14 dígitos/);
    assert.throws(() => parseBrDocument("11222333000180", "cnpj"), /CNPJ inválido/);
    assert.equal(parseBrDocument("11.222.333/0001-81", "cnpj"), "11222333000181");
    assert.equal(sellerDocKind("mei"), "cnpj");
    assert.equal(sellerDocKind("pj"), "cnpj");
    assert.equal(sellerDocKind("clt"), "cpf");
    assert.equal(maskCnpj("11222333000181"), "11.222.333/0001-81");
    assert.equal(maskCnpj("11222"), "11.222");
    assert.equal(parseCnpj("11.222.333/0001-81"), "11222333000181");
    assert.equal(maskCpf("52998224725"), "529.982.247-25");
    assert.equal(maskBrDoc("11222333000181"), "11.222.333/0001-81");
  });
});
