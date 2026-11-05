import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mensagemDeErro } from "./run-action.ts";

describe("mensagemDeErro", () => {
  it("erro do servidor (Error comum) mostra a mensagem em pt-BR dele", () => {
    assert.equal(
      mensagemDeErro(new Error("Este título já está quitado.")),
      "Este título já está quitado.",
    );
  });

  it("falha de rede (TypeError -- fetch que nunca completou) usa o fallback, nao o texto em ingles", () => {
    assert.equal(
      mensagemDeErro(new TypeError("Failed to fetch"), "Não foi possível salvar a nota."),
      "Não foi possível salvar a nota.",
    );
  });

  it("TypeError sem fallback explicito cai no texto generico, nunca no 'Failed to fetch'", () => {
    assert.equal(mensagemDeErro(new TypeError("Failed to fetch")), "Não foi possível concluir.");
  });

  it("algo que nem e Error (string lancada, por exemplo) usa o fallback", () => {
    assert.equal(mensagemDeErro("string solta", "Falha ao salvar."), "Falha ao salvar.");
  });
});
