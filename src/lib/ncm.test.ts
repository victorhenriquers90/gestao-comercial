import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatNcm, hasNcm, ncmValidSql, parseCfop, parseNcm } from "./ncm.ts";

describe("parseNcm", () => {
  it("aceita as três formas que chegam do contador", () => {
    assert.equal(parseNcm("6109.10.00"), "61091000");
    assert.equal(parseNcm("6109 10 00"), "61091000");
    assert.equal(parseNcm("61091000"), "61091000");
    assert.equal(parseNcm("6109-10-00"), "61091000");
  });

  it("campo vazio é null, não erro", () => {
    // NCM é opcional no cadastro; vira obrigatório só na hora de emitir.
    assert.equal(parseNcm(""), null);
    assert.equal(parseNcm("   "), null);
    assert.equal(parseNcm(null), null);
    assert.equal(parseNcm(undefined), null);
  });

  it("recusa o que passava antes por sanitizeCode", () => {
    // Estes três eram gravados como NCM válido e só explodiam na recusa do
    // SEFAZ, no balcão, com o cliente esperando.
    assert.throws(() => parseNcm("abc"), /só números/);
    assert.throws(() => parseNcm("camiseta"), /só números/);
    assert.throws(() => parseNcm("6109ABCD"), /só números/);
  });

  it("recusa contagem de dígitos errada, dizendo quantos veio", () => {
    assert.throws(() => parseNcm("610910"), /8 dígitos; recebi 6/);
    assert.throws(() => parseNcm("610910001"), /recebi 9/);
    assert.throws(() => parseNcm("1"), /recebi 1/);
  });

  it("zeros não passam por classificação", () => {
    // Campo em branco disfarçado: passaria pela checagem de "tem NCM?".
    assert.throws(() => parseNcm("00000000"), /inválido/);
    assert.throws(() => parseNcm("0000.00.00"), /inválido/);
  });

  it("não inventa nada: número válido entra como veio", () => {
    assert.equal(parseNcm("62034200"), "62034200");
    assert.equal(parseNcm("64041900"), "64041900");
  });
});

describe("formatNcm", () => {
  it("mostra do jeito que o contador escreve", () => {
    assert.equal(formatNcm("61091000"), "6109.10.00");
  });

  it("não mascara o que não é NCM, pra o erro continuar visível", () => {
    assert.equal(formatNcm("123"), "123");
    assert.equal(formatNcm(null), "");
    assert.equal(formatNcm(""), "");
  });
});

describe("hasNcm", () => {
  it("só o que emitiria de verdade conta como preenchido", () => {
    assert.equal(hasNcm("6109.10.00"), true);
    assert.equal(hasNcm(""), false);
    assert.equal(hasNcm(null), false);
    assert.equal(hasNcm("abc"), false);
    assert.equal(hasNcm("610910"), false);
    assert.equal(hasNcm("00000000"), false);
  });
});

describe("parseCfop", () => {
  it("aceita as formas que chegam do contador/planilha", () => {
    assert.equal(parseCfop("5.102"), "5102");
    assert.equal(parseCfop("5 102"), "5102");
    assert.equal(parseCfop("5102"), "5102");
    assert.equal(parseCfop("5-102"), "5102");
  });

  it("campo vazio é null, não erro", () => {
    assert.equal(parseCfop(""), null);
    assert.equal(parseCfop("   "), null);
    assert.equal(parseCfop(null), null);
    assert.equal(parseCfop(undefined), null);
  });

  it("recusa o que passava antes por sanitizeCode(cfop, 4)", () => {
    // "5.102" cortado em 4 caracteres virava "5.10" -- com ponto e faltando
    // o ultimo digito -- e so explodia na recusa do SEFAZ, no balcao.
    assert.throws(() => parseCfop("abc"), /só números/);
    assert.throws(() => parseCfop("51a2"), /só números/);
  });

  it("recusa contagem de dígitos errada, dizendo quantos veio", () => {
    assert.throws(() => parseCfop("510"), /4 dígitos; recebi 3/);
    assert.throws(() => parseCfop("51020"), /recebi 5/);
  });

  it("não inventa nada: número válido entra como veio", () => {
    assert.equal(parseCfop("6102"), "6102");
    assert.equal(parseCfop("1102"), "1102");
  });
});

describe("ncmValidSql", () => {
  it("é NULL-safe — foi isso que quebrou na medição", () => {
    // Sem coalesce: NULL ~ regex dá NULL, not NULL dá NULL, e
    // `filter (where NULL)` não conta a linha. Resultado medido no banco:
    // 1 pendente pelo SQL contra 11 pelo JS, com o cadastro todo em branco.
    // A prova real é contra o Postgres; este teste existe pra ninguém tirar
    // o coalesce achando que é enfeite.
    assert.match(ncmValidSql(), /coalesce\(ncm, ''\)/);
    assert.equal(ncmValidSql().includes("coalesce"), true);
  });

  it("qualifica a coluna quando há join", () => {
    assert.match(ncmValidSql("p.ncm"), /coalesce\(p\.ncm, ''\)/);
  });

  it("exige a mesma coisa que hasNcm: 8 dígitos e não-zeros", () => {
    const sql = ncmValidSql();
    assert.match(sql, /\^\[0-9\]\{8\}\$/);
    assert.match(sql, /<> '00000000'/);
  });
});
