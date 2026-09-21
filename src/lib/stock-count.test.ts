import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  divergenceValue,
  isStockCountStatus,
  lineDiff,
  parseCountedQuantity,
  summarize,
} from "./stock-count.ts";

describe("lineDiff", () => {
  it("falta na prateleira e diferenca NEGATIVA", () => {
    // Sistema diz 10, a prateleira tem 8: faltam 2.
    assert.equal(lineDiff({ variantId: 1, expected: 10, counted: 8 }).diff, -2);
  });

  it("sobra e diferenca positiva", () => {
    assert.equal(lineDiff({ variantId: 1, expected: 3, counted: 5 }).diff, 2);
  });

  it("bateu e zero", () => {
    assert.equal(lineDiff({ variantId: 1, expected: 7, counted: 7 }).diff, 0);
  });

  it("nao acumula erro de ponto flutuante", () => {
    // 0.3 - 0.1 da 0.19999999999999998 em float.
    assert.equal(lineDiff({ variantId: 1, expected: 0.1, counted: 0.3 }).diff, 0.2);
  });
});

describe("parseCountedQuantity", () => {
  it("zero e legitimo -- significa que acabou", () => {
    assert.equal(parseCountedQuantity(0), 0);
  });

  it("aceita fracao (peso, metro)", () => {
    assert.equal(parseCountedQuantity(2.5), 2.5);
    assert.equal(parseCountedQuantity("1.234"), 1.234);
  });

  it("recusa negativo, NaN e infinito", () => {
    // Mesma familia dos outros campos numericos: `>= 0` sozinho nao pega NaN.
    assert.throws(() => parseCountedQuantity(-1), /válida/);
    assert.throws(() => parseCountedQuantity(Number.NaN), /válida/);
    assert.throws(() => parseCountedQuantity(Number.POSITIVE_INFINITY), /válida/);
    assert.throws(() => parseCountedQuantity("abc"), /válida/);
    assert.throws(() => parseCountedQuantity(undefined), /válida/);
  });

  it("usa o rotulo informado", () => {
    assert.throws(() => parseCountedQuantity(-1, "contagem da peça"), /contagem da peça/);
  });
});

describe("summarize", () => {
  const linhas = [
    { variantId: 1, expected: 10, counted: 8 }, // falta 2
    { variantId: 2, expected: 5, counted: 5 }, // bateu
    { variantId: 3, expected: 0, counted: 3 }, // sobra 3
    { variantId: 4, expected: 4, counted: 0 }, // falta 4
  ];

  it("separa sobra de falta em vez de so somar o liquido", () => {
    const s = summarize(linhas);
    assert.equal(s.items, 4);
    assert.equal(s.divergentes, 3);
    assert.equal(s.faltas, 6);
    assert.equal(s.sobras, 3);
    // O liquido sozinho (-3) esconderia que 6 sumiram e 3 apareceram: numa
    // loja, falta e furto/erro e sobra e recebimento nao lancado. Sao
    // problemas diferentes e precisam aparecer separados.
    assert.equal(s.liquido, -3);
  });

  it("contagem que bateu inteira nao tem divergente", () => {
    const s = summarize([{ variantId: 1, expected: 3, counted: 3 }]);
    assert.equal(s.divergentes, 0);
    assert.equal(s.liquido, 0);
  });

  it("lista vazia nao quebra", () => {
    assert.deepEqual(summarize([]), { items: 0, divergentes: 0, sobras: 0, faltas: 0, liquido: 0 });
  });
});

describe("divergenceValue", () => {
  it("avalia a divergencia pelo CUSTO", () => {
    // Falta de 2 pecas que custaram 30 = -60 de prejuizo real.
    assert.equal(divergenceValue([{ variantId: 1, expected: 10, counted: 8, cost: 30 }]), -60);
  });

  it("sobra entra positiva e compensa", () => {
    const v = divergenceValue([
      { variantId: 1, expected: 10, counted: 8, cost: 30 },
      { variantId: 2, expected: 0, counted: 1, cost: 50 },
    ]);
    assert.equal(v, -10);
  });

  it("custo ausente conta como zero, nao quebra a conta", () => {
    assert.equal(
      divergenceValue([{ variantId: 1, expected: 5, counted: 1, cost: Number.NaN }]),
      0,
    );
  });
});

describe("isStockCountStatus", () => {
  it("aceita so os tres status", () => {
    assert.equal(isStockCountStatus("aberto"), true);
    assert.equal(isStockCountStatus("aplicado"), true);
    assert.equal(isStockCountStatus("cancelado"), true);
    assert.equal(isStockCountStatus("qualquer"), false);
    assert.equal(isStockCountStatus(null), false);
  });
});
