import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OverlayStack } from "./overlay-history.ts";

describe("OverlayStack", () => {
  it("push is idempotent per id and keeps the latest closer", () => {
    const stack = new OverlayStack();
    let n = 0;
    assert.equal(stack.push("a", () => { n = 1; }), "push");
    assert.equal(stack.push("a", () => { n = 2; }), "refresh");
    assert.equal(stack.layers.length, 1);
    stack.onPopState();
    assert.equal(n, 2);
    assert.equal(stack.layers.length, 0);
  });

  it("system back closes the top overlay", () => {
    const stack = new OverlayStack();
    const closed: string[] = [];
    stack.push("a", () => closed.push("a"));
    stack.push("b", () => closed.push("b"));
    stack.onPopState();
    assert.deepEqual(closed, ["b"]);
    assert.equal(stack.has("a"), true);
    assert.equal(stack.has("b"), false);
  });

  it("UI close does not also fire on the following popstate", () => {
    const stack = new OverlayStack();
    let closed = 0;
    stack.push("a", () => {
      closed += 1;
    });
    assert.equal(stack.releaseFromUi("a"), true);
    stack.onPopState();
    assert.equal(closed, 0);
    assert.equal(stack.layers.length, 0);
  });

  it("nested UI close only pops the named layer", () => {
    const stack = new OverlayStack();
    stack.push("a", () => {});
    stack.push("b", () => {});
    stack.releaseFromUi("b");
    assert.equal(stack.has("a"), true);
    assert.equal(stack.has("b"), false);
  });

  it("abandon drops without scheduling a pop ignore", () => {
    const stack = new OverlayStack();
    let closed = 0;
    stack.push("a", () => {
      closed += 1;
    });
    stack.abandon("a");
    stack.onPopState();
    assert.equal(closed, 0);
    assert.equal(stack.ignorePop, 0);
  });
});
