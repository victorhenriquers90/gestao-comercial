import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CSRF_COOKIE, csrfTokensMatch, readCookieValue, shouldSkipCsrf } from "./csrf.ts";

describe("csrf double-submit", () => {
  it("reads the named cookie", () => {
    const t = "a".repeat(32);
    assert.equal(readCookieValue(`${CSRF_COOKIE}=${t}; other=1`, CSRF_COOKIE), t);
    assert.equal(readCookieValue("x=y", CSRF_COOKIE), null);
  });

  it("requires both tokens to be the same 32 hex", () => {
    const t = "b".repeat(32);
    assert.equal(csrfTokensMatch(t, t), true);
    assert.equal(csrfTokensMatch(t, "c".repeat(32)), false);
    assert.equal(csrfTokensMatch(t, null), false);
    assert.equal(csrfTokensMatch("short", "short"), false);
  });

  it("skips safe methods and non-browser", () => {
    assert.equal(shouldSkipCsrf("GET", "cross-site"), true);
    assert.equal(shouldSkipCsrf("POST", null), true);
    assert.equal(shouldSkipCsrf("POST", "none"), true);
    assert.equal(shouldSkipCsrf("POST", "same-origin"), false);
    assert.equal(shouldSkipCsrf("POST", "same-site"), false);
  });
});
