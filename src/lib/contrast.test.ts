import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyContrastClass, shouldUseContrast } from "./contrast.ts";

describe("shouldUseContrast", () => {
  it("honors an explicit on/off", () => {
    assert.equal(shouldUseContrast("on", false), true);
    assert.equal(shouldUseContrast("off", true), false);
  });

  it("follows the OS when the user has not chosen", () => {
    assert.equal(shouldUseContrast(null, true), true);
    assert.equal(shouldUseContrast(null, false), false);
    assert.equal(shouldUseContrast("", true), true);
  });
});

describe("applyContrastClass", () => {
  it("toggles the contrast class", () => {
    const classes = new Set<string>();
    const root = {
      classList: {
        toggle(name: string, force?: boolean) {
          if (force) classes.add(name);
          else classes.delete(name);
          return force ?? false;
        },
      },
    };
    assert.equal(applyContrastClass(root, "on", false), true);
    assert.equal(classes.has("contrast"), true);
    applyContrastClass(root, "off", true);
    assert.equal(classes.has("contrast"), false);
  });
});
