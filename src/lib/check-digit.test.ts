import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { gtinCheckDigit, isValidGtin, mod11Digit, parseBarcode } from "./check-digit.ts";
import { isValidCnpj, isValidCpf } from "./document.ts";

describe("check digits", () => {
  it("mod-11 matches CPF/CNPJ", () => {
    assert.equal(isValidCpf("529.982.247-25"), true);
    assert.equal(isValidCnpj("11.222.333/0001-81"), true);
    assert.equal(mod11Digit([5, 2, 9, 9, 8, 2, 2, 4, 7], [10, 9, 8, 7, 6, 5, 4, 3, 2]), 2);
  });

  it("GTIN-13 / EAN-8 use the GS1 weight from the right", () => {
    assert.equal(gtinCheckDigit("400638133393"), 1);
    assert.equal(isValidGtin("4006381333931"), true);
    assert.equal(isValidGtin("4006381333930"), false);
    assert.equal(isValidGtin("96385074"), true);
    assert.equal(isValidGtin("0000000000000"), false);
  });

  it("parseBarcode enforces GTIN only on 8/12/13/14 digits", () => {
    assert.equal(parseBarcode("4006 3813 3393 1"), "4006381333931");
    assert.equal(parseBarcode("CAM-P-AZ"), "CAM-P-AZ");
    assert.equal(parseBarcode("1234"), "1234");
    assert.equal(parseBarcode(""), null);
    assert.throws(() => parseBarcode("4006381333930"), /dígito verificador/);
  });
});
