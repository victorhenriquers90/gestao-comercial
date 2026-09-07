import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  boundPopupState,
  createOAuthState,
  isAllowedOAuthProvider,
  isOAuthState,
  parseOAuthPopupMessage,
  statesEqual,
  OAUTH_POPUP_SOURCE,
} from "./oauth-state.ts";

describe("oauth state", () => {
  it("mints 32 hex chars", () => {
    const a = createOAuthState();
    const b = createOAuthState();
    assert.equal(isOAuthState(a), true);
    assert.notEqual(a, b);
  });

  it("rejects malformed state", () => {
    assert.equal(isOAuthState(""), false);
    assert.equal(isOAuthState("abc"), false);
    assert.equal(isOAuthState("g".repeat(32)), false);
    assert.equal(isOAuthState("a".repeat(32)), true);
  });

  it("compares states in full", () => {
    const s = "a".repeat(32);
    assert.equal(statesEqual(s, s), true);
    assert.equal(statesEqual(s, "b".repeat(32)), false);
    assert.equal(statesEqual(s, "a".repeat(31)), false);
  });

  it("allowlists provider ids", () => {
    const providers = [{ providerId: "grok-google", idp: "google", label: "Google" }] as const;
    assert.equal(isAllowedOAuthProvider("grok-google", providers), true);
    assert.equal(isAllowedOAuthProvider("grok-x", providers), false);
    assert.equal(isAllowedOAuthProvider("", providers), false);
  });

  it("accepts popup message only with origin + state", () => {
    const state = "c".repeat(32);
    const ok = {
      source: OAUTH_POPUP_SOURCE,
      token: "tok",
      state,
    };
    assert.ok(parseOAuthPopupMessage(ok, "https://loja.test", "https://loja.test", state));
    assert.equal(
      parseOAuthPopupMessage(ok, "https://loja.test", "https://evil.test", state),
      null,
    );
    assert.equal(
      parseOAuthPopupMessage({ ...ok, state: "d".repeat(32) }, "https://loja.test", "https://loja.test", state),
      null,
    );
    assert.equal(
      parseOAuthPopupMessage({ source: "other", token: "tok", state }, "https://loja.test", "https://loja.test", state),
      null,
    );
  });

  it("binds done=1 to the popup cookie, not the query alone", () => {
    const s = "e".repeat(32);
    assert.equal(boundPopupState(null, s), s);
    assert.equal(boundPopupState(s, s), s);
    assert.equal(boundPopupState(s, null), null);
    assert.equal(boundPopupState("f".repeat(32), s), null);
    assert.equal(boundPopupState("nope", s), null);
  });
});
