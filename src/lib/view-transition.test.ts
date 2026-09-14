import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveViewTransitionTypes } from "./view-transition.ts";

describe("resolveViewTransitionTypes", () => {
  const base = {
    fromPath: "/app",
    toPath: "/app/vendas",
    pathChanged: true,
    isBack: false,
    reducedMotion: false,
  };

  it("returns forward on a new route", () => {
    assert.deepEqual(resolveViewTransitionTypes(base), ["forward"]);
  });

  it("returns back on pop", () => {
    assert.deepEqual(resolveViewTransitionTypes({ ...base, isBack: true, fromPath: "/app/vendas", toPath: "/app" }), [
      "back",
    ]);
  });

  it("skips when the path did not change", () => {
    assert.equal(resolveViewTransitionTypes({ ...base, pathChanged: false, toPath: "/app" }), false);
  });

  it("skips reduced motion", () => {
    assert.equal(resolveViewTransitionTypes({ ...base, reducedMotion: true }), false);
  });

  it("skips entering or leaving the PDV", () => {
    assert.equal(resolveViewTransitionTypes({ ...base, toPath: "/app/pdv" }), false);
    assert.equal(resolveViewTransitionTypes({ ...base, fromPath: "/app/pdv", toPath: "/app" }), false);
  });
});
