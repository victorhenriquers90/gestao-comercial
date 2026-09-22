import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canEmitForReal,
  homologationWarning,
  nfceBlockers,
  type ReadinessInput,
} from "./nfce-readiness.ts";

const pronto: ReadinessInput = {
  tokenPresent: true,
  env: "producao",
  enabled: true,
  hasCnpj: true,
  hasIe: true,
  produtosTotal: 48,
  produtosSemNcm: 0,
};

describe("nfceBlockers", () => {
  it("tudo pronto: nenhuma pendência", () => {
    assert.deepEqual(nfceBlockers(pronto), []);
  });

  it("loja recém-instalada: mostra tudo de uma vez, não uma venda por vez", () => {
    // O estado real da loja piloto quando isto foi escrito.
    const zerado: ReadinessInput = {
      tokenPresent: false,
      env: "homologacao",
      enabled: false,
      hasCnpj: false,
      hasIe: false,
      produtosTotal: 48,
      produtosSemNcm: 48,
    };
    const ids = nfceBlockers(zerado).map((b) => b.id);
    assert.deepEqual(ids, ["token", "cnpj", "ie", "ncm", "enabled"]);
  });

  it("separa o que se resolve aqui do que depende de contrato e certificado", () => {
    const zerado = { ...pronto, tokenPresent: false, hasCnpj: false };
    const fora = nfceBlockers(zerado).filter((b) => b.scope === "fora");
    assert.deepEqual(
      fora.map((b) => b.id),
      ["token"],
    );
  });

  it("a credencial vem primeiro: sem ela, preencher campo não faz emitir", () => {
    const ids = nfceBlockers({ ...pronto, tokenPresent: false, hasIe: false }).map((b) => b.id);
    assert.equal(ids[0], "token");
  });

  it("NCM parcial fala de recusa; NCM zerado fala do cadastro inteiro", () => {
    const parcial = nfceBlockers({ ...pronto, produtosSemNcm: 3 })[0]!;
    assert.match(parcial.label, /3 produto/);
    assert.match(parcial.detail, /recusadas/);
    const total = nfceBlockers({ ...pronto, produtosSemNcm: 48 })[0]!;
    assert.match(total.detail, /Nenhum produto/);
  });

  it("emissão desligada é pendência, não silêncio", () => {
    // Sem isto a tela ficaria "tudo certo" e a ação nem apareceria em Vendas.
    const ids = nfceBlockers({ ...pronto, enabled: false }).map((b) => b.id);
    assert.deepEqual(ids, ["enabled"]);
  });
});

describe("homologationWarning", () => {
  it("produção não avisa nada", () => {
    assert.equal(homologationWarning(pronto), null);
  });

  it("o estado perigoso: tudo verde, emitindo teste", () => {
    // Emite, responde "autorizado", gera chave e DANFE -- e nao vale nada.
    const aviso = homologationWarning({ ...pronto, env: "homologacao" })!;
    assert.match(aviso, /TESTE/);
    assert.match(aviso, /FOCUS_NFE_ENV=producao/);
  });

  it("sem token, o aviso é sobre o que vai acontecer depois", () => {
    const aviso = homologationWarning({ ...pronto, env: "homologacao", tokenPresent: false })!;
    assert.match(aviso, /padrão é homologação/);
  });
});

describe("canEmitForReal", () => {
  it("só com tudo resolvido E em produção", () => {
    assert.equal(canEmitForReal(pronto), true);
    assert.equal(canEmitForReal({ ...pronto, env: "homologacao" }), false);
    assert.equal(canEmitForReal({ ...pronto, produtosSemNcm: 1 }), false);
  });

  it("homologação com tudo preenchido não conta como pronto", () => {
    // O ponto: lista de pendencias vazia NAO significa nota valida.
    const semPendencia = nfceBlockers({ ...pronto, env: "homologacao" });
    assert.equal(semPendencia.length, 0);
    assert.equal(canEmitForReal({ ...pronto, env: "homologacao" }), false);
  });
});
