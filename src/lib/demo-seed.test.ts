import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoSeedEnabled } from "./demo-seed.ts";

describe("demoSeedEnabled", () => {
  it("instalacao real (Postgres configurado) comeca sem demonstracao", () => {
    assert.equal(demoSeedEnabled("neon", undefined), false);
  });

  it("preview local (PGLite) continua com demonstracao", () => {
    assert.equal(demoSeedEnabled("pglite", undefined), true);
  });

  it("GC_DEMO_SEED=1 liga mesmo com Postgres", () => {
    assert.equal(demoSeedEnabled("neon", "1"), true);
  });

  it("GC_DEMO_SEED=0 desliga mesmo no preview", () => {
    assert.equal(demoSeedEnabled("pglite", "0"), false);
  });

  it("valor vazio ou estranho cai no padrao, nao liga por acidente", () => {
    assert.equal(demoSeedEnabled("neon", ""), false);
    assert.equal(demoSeedEnabled("neon", " "), false);
    assert.equal(demoSeedEnabled("neon", "true"), false);
    assert.equal(demoSeedEnabled("neon", " 1 "), true);
  });
});
