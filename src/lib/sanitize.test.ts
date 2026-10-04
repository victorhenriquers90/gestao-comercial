import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  optionalLine,
  parseCursor,
  parseUf,
  requireIsoDate,
  requireLine,
  requireMoney,
  requireRange,
  sanitizeCode,
  sanitizeHttpUrl,
  sanitizeImageUrl,
  sanitizeLine,
  sanitizeMultiline,
} from "./sanitize.ts";

describe("sanitize input", () => {
  it("strips tags and controls from a name", () => {
    assert.equal(sanitizeLine("  Camiseta\u0000 <script>x</script> Azul  "), "Camiseta x Azul");
    assert.equal(requireLine("Peça", "Nome"), "Peça");
    assert.throws(() => requireLine("   ", "Nome"));
  });

  it("keeps newlines in notes, drops tags", () => {
    assert.equal(sanitizeMultiline("linha 1\n<script>z</script>\nlinha 2"), "linha 1\nz\nlinha 2");
    assert.equal(sanitizeMultiline("   "), null);
  });

  it("rejects javascript and protocol-relative URLs", () => {
    assert.equal(sanitizeHttpUrl("javascript:alert(1)"), null);
    assert.equal(sanitizeHttpUrl("data:text/html,x"), null);
    assert.equal(sanitizeHttpUrl("//evil.test/x"), null);
    assert.equal(sanitizeHttpUrl("/login-store.jpg"), "/login-store.jpg");
    assert.ok(sanitizeHttpUrl("https://cdn.example/a.png")?.startsWith("https://"));
    assert.equal(optionalLine(""), null);
    assert.equal(sanitizeCode("  789123  "), "789123");
  });

  it("accepts an image data URL (what the crop editor always sends) but not other data:", () => {
    const foto = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wA=";
    assert.equal(sanitizeImageUrl(foto), foto);
    assert.equal(sanitizeImageUrl("data:text/html,<script>x</script>"), null);
    assert.equal(sanitizeImageUrl("javascript:alert(1)"), null);
    assert.equal(sanitizeImageUrl("data:image/jpeg;base64," + "A".repeat(3_000_000)), null);
    assert.ok(sanitizeImageUrl("https://cdn.example/logo.png")?.startsWith("https://"));
  });
});

describe("UF e faixa numerica", () => {
  it("UF: 2 letras maiusculas, vazio vira undefined, o resto e erro", () => {
    assert.equal(parseUf("sp"), "SP");
    assert.equal(parseUf("  "), undefined);
    assert.equal(parseUf(null), undefined);
    assert.throws(() => parseUf("São Paulo"), /UF deve ter 2 letras/);
    assert.throws(() => parseUf("S"), /UF deve ter 2 letras/);
    assert.throws(() => parseUf("12"), /UF deve ter 2 letras/);
  });

  it("faixa: aceita dentro, arredonda a 2 casas, recusa fora/ausente/NaN", () => {
    assert.equal(requireRange(5, "Comissão", 0, 100), 5);
    assert.equal(requireRange("7.256", "Comissão", 0, 100), 7.26);
    assert.equal(requireRange(0, "Comissão", 0, 100), 0);
    assert.equal(requireRange(100, "Comissão", 0, 100), 100);
    assert.throws(() => requireRange(150, "Comissão", 0, 100), /Comissão deve ficar entre 0 e 100/);
    assert.throws(() => requireRange(-1, "Comissão", 0, 100), /entre 0 e 100/);
    assert.throws(() => requireRange(undefined, "Comissão", 0, 100), /entre 0 e 100/);
    assert.throws(() => requireRange(null, "Comissão", 0, 100), /entre 0 e 100/);
    assert.throws(() => requireRange("", "Comissão", 0, 100), /entre 0 e 100/);
    assert.throws(() => requireRange(Number.NaN, "Comissão", 0, 100), /entre 0 e 100/);
    assert.throws(() => requireRange(Infinity, "Comissão", 0, 100), /entre 0 e 100/);
  });
});

describe("parseCursor", () => {
  it("aceita inteiro positivo, inclusive vindo como texto", () => {
    assert.equal(parseCursor(120), 120);
    assert.equal(parseCursor("120"), 120);
  });

  it("lixo vira undefined (primeira pagina) em vez de erro de banco", () => {
    for (const ruim of [undefined, null, "", "  ", "abc", 0, -5, 1.5, Number.NaN, Infinity, 2 ** 60, {}, []]) {
      assert.equal(parseCursor(ruim), undefined, String(ruim));
    }
  });
});

describe("requireMoney e requireIsoDate", () => {
  it("valor: arredonda ao centavo e aceita texto numerico", () => {
    assert.equal(requireMoney(12.345, "Valor"), 12.35);
    assert.equal(requireMoney("50", "Valor"), 50);
    assert.equal(requireMoney(0.01, "Valor"), 0.01);
  });

  it("valor: zero, negativo, vazio, NaN, infinito e acima do teto sao erro", () => {
    for (const ruim of [0, -50, -0.001, 0.004, "", null, undefined, "abc", Number.NaN, Infinity, 1_000_000_000]) {
      assert.throws(() => requireMoney(ruim, "Valor"), /Valor inválido/, String(ruim));
    }
  });

  it("data: aceita dia real e recusa 31/02, ano fora de 2000-2100, formato torto e nao-texto", () => {
    assert.equal(requireIsoDate(" 2026-10-04 ", "Vencimento"), "2026-10-04");
    assert.equal(requireIsoDate("2028-02-29", "Vencimento"), "2028-02-29");
    for (const ruim of ["2026-02-31", "2027-02-29", "0002-05-03", "2101-01-01", "04/10/2026", "2026-1-5", "", null, undefined, 20261004]) {
      assert.throws(() => requireIsoDate(ruim, "Vencimento"), /Vencimento: informe uma data válida/, String(ruim));
    }
  });
});
