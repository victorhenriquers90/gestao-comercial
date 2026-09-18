import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { can, type Perm, type Role } from "./permissions.ts";

/**
 * O papel "pdv" existe para o terminal de caixa e nada mais: a regra do
 * produto e que ele nao enxerga venda, produto, compra ou fornecedor "nem no
 * menu nem no servidor". Esconder a tela nao basta -- foi por ai que a busca
 * global (Ctrl+K) vazou as quatro secoes para esse papel, por ser a unica
 * leitura sem checagem de permissao. Estes testes fixam a fronteira, para a
 * proxima leitura nova nao reabrir o mesmo buraco.
 */
describe("papel pdv", () => {
  const negadas: Perm[] = [
    "products.read",
    "suppliers.read",
    "sales.read",
    "purchases.read",
    "dashboard.read",
    "finance.read",
    "reports.read",
  ];

  for (const perm of negadas) {
    it(`nao concede ${perm}`, () => {
      assert.equal(can("pdv", perm), false);
    });
  }

  const concedidas: Perm[] = ["pdv.sell", "customers.read", "cash.read", "cash.write"];

  for (const perm of concedidas) {
    it(`concede ${perm}`, () => {
      assert.equal(can("pdv", perm), true);
    });
  }
});

describe("fronteira de leitura por papel", () => {
  it("so admin e gerente leem o financeiro", () => {
    const papeis: Role[] = ["admin", "gerente", "vendedor", "caixa", "pdv", "estoque", "financeiro"];
    const comAcesso = papeis.filter((r) => can(r, "finance.read"));
    assert.deepEqual(comAcesso.sort(), ["admin", "financeiro", "gerente"]);
  });

  it("vendedor nao mexe em produto", () => {
    assert.equal(can("vendedor", "products.write"), false);
  });

  /**
   * users.read foi separada de users.write justamente para o gerente: ele
   * precisa enxergar o time que toca, mas nao promove ninguem. Se as duas
   * voltarem a andar juntas, a separacao perdeu o sentido e este teste avisa.
   */
  it("gerente ve a equipe mas nao a gerencia", () => {
    assert.equal(can("gerente", "users.read"), true);
    assert.equal(can("gerente", "users.write"), false);
  });

  it("quem gerencia tambem ve", () => {
    const papeis: Role[] = ["admin", "gerente", "vendedor", "caixa", "pdv", "estoque", "financeiro"];
    for (const papel of papeis) {
      if (can(papel, "users.write")) assert.equal(can(papel, "users.read"), true, papel);
    }
  });

  it("papeis de operacao nao veem a equipe", () => {
    for (const papel of ["vendedor", "caixa", "pdv", "estoque", "financeiro"] as Role[]) {
      assert.equal(can(papel, "users.read"), false, papel);
    }
  });
});
