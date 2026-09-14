import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyKeyboardInset, insetFromVisualViewport, KEYBOARD_INSET_VAR } from "./virtual-keyboard.ts";

describe("insetFromVisualViewport", () => {
  it("is zero when the viewport fills the window", () => {
    assert.equal(insetFromVisualViewport(800, 800, 0), 0);
  });

  it("returns the covered strip (keyboard + browser chrome)", () => {
    assert.equal(insetFromVisualViewport(800, 500, 0), 300);
  });

  it("subtracts offsetTop (iOS URL bar)", () => {
    assert.equal(insetFromVisualViewport(800, 500, 40), 260);
  });
});

describe("applyKeyboardInset", () => {
  it("sets the CSS var and vk-open when the keyboard is up", () => {
    const props = new Map<string, string>();
    const classes = new Set<string>();
    const root = {
      classList: {
        toggle(name: string, force?: boolean) {
          if (force) classes.add(name);
          else classes.delete(name);
        },
      },
      style: {
        setProperty(k: string, v: string) {
          props.set(k, v);
        },
        removeProperty(k: string) {
          props.delete(k);
        },
      },
    };
    assert.equal(applyKeyboardInset(root, 312.4), 312);
    assert.equal(props.get(KEYBOARD_INSET_VAR), "312px");
    assert.equal(classes.has("vk-open"), true);
    applyKeyboardInset(root, 0);
    assert.equal(props.has(KEYBOARD_INSET_VAR), false);
    assert.equal(classes.has("vk-open"), false);
  });
});
