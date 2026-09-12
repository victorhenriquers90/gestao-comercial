import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { timingSafeEqual } from "node:crypto";
import {
  CSRF_COOKIE,
  CSRF_COOKIE_FALLBACK,
  csrfCookieWrite,
  csrfRequestAllowed,
  csrfTokensMatch,
  decodeCsrfToken,
  isSameOriginFetch,
  readCookieValue,
  readCsrfCookie,
  shouldSkipCsrf,
  timingSafeEqualBytes,
} from "./csrf.ts";

describe("csrf double-submit", () => {
  it("reads the named cookie", () => {
    const t = "a".repeat(32);
    assert.equal(readCookieValue(`${CSRF_COOKIE}=${t}; other=1`, CSRF_COOKIE), t);
    assert.equal(readCookieValue("x=y", CSRF_COOKIE), null);
  });

  it("reads the fallback cookie when the Host cookie is missing", () => {
    const t = "d".repeat(32);
    assert.equal(readCsrfCookie(`${CSRF_COOKIE_FALLBACK}=${t}`), t);
    assert.equal(readCsrfCookie(`${CSRF_COOKIE}=${t}`), t);
  });

  it("writes a non-Host cookie when the context is not secure", () => {
    const t = "e".repeat(32);
    const insecure = csrfCookieWrite(t, false);
    assert.equal(insecure.length, 1);
    assert.match(insecure[0]!, new RegExp(`^${CSRF_COOKIE_FALLBACK}=${t}`));
    assert.doesNotMatch(insecure[0]!, /Secure/);
    const secure = csrfCookieWrite(t, true);
    assert.equal(secure.length, 2);
    assert.match(secure.join("\n"), /__Host-grok-auth\.csrf/);
  });

  it("requires both tokens to be the same 32 hex", () => {
    const t = "b".repeat(32);
    assert.equal(csrfTokensMatch(t, t), true);
    assert.equal(csrfTokensMatch(t, "c".repeat(32)), false);
    assert.equal(csrfTokensMatch(t, null), false);
    assert.equal(csrfTokensMatch("short", "short"), false);
  });

  it("compares tokens in a fixed 16-byte window without treating invalids as equal", () => {
    const a = "ab".repeat(16);
    const bFirst = `00${a.slice(2)}`;
    const bLast = `${a.slice(0, 30)}00`;
    assert.equal(csrfTokensMatch(a, bFirst), false);
    assert.equal(csrfTokensMatch(a, bLast), false);

    const decoded = decodeCsrfToken(a);
    const again = decodeCsrfToken(a);
    assert.equal(decoded.valid, 1);
    assert.equal(
      timingSafeEqual(Buffer.from(decoded.bytes), Buffer.from(again.bytes)),
      true,
    );
    assert.equal(timingSafeEqualBytes(decoded.bytes, again.bytes), 1);
    assert.equal(timingSafeEqualBytes(decoded.bytes, decodeCsrfToken(bFirst).bytes), 0);

    // Two missing/malformed values must not match via the dummy buffer.
    assert.equal(csrfTokensMatch(null, null), false);
    assert.equal(csrfTokensMatch("0".repeat(32), null), false);
    assert.equal(csrfTokensMatch("z".repeat(32), "z".repeat(32)), false);
    assert.equal(decodeCsrfToken(null).valid, 0);
    assert.equal(decodeCsrfToken("z".repeat(32)).valid, 0);
  });

  it("skips safe methods and non-browser", () => {
    assert.equal(shouldSkipCsrf("GET", "cross-site"), true);
    assert.equal(shouldSkipCsrf("POST", null), true);
    assert.equal(shouldSkipCsrf("POST", "none"), true);
    assert.equal(shouldSkipCsrf("POST", "same-origin"), false);
    assert.equal(shouldSkipCsrf("POST", "same-site"), false);
  });

  it("treats same-origin fetch as eligible for header-only CSRF", () => {
    assert.equal(isSameOriginFetch("same-origin"), true);
    assert.equal(isSameOriginFetch("same-site"), true);
    assert.equal(isSameOriginFetch("cross-site"), false);
    assert.equal(isSameOriginFetch(null), false);
  });

  it("allows same-origin POST when the cookie is missing but the header is a nonce", () => {
    const t = "f".repeat(32);
    assert.equal(
      csrfRequestAllowed({
        method: "POST",
        fetchSite: "same-origin",
        cookieToken: null,
        headerToken: t,
      }),
      true,
    );
    assert.equal(
      csrfRequestAllowed({
        method: "POST",
        fetchSite: "cross-site",
        cookieToken: null,
        headerToken: t,
      }),
      false,
    );
  });

  it("rejects same-origin POST when cookie and header disagree", () => {
    const cookie = "a".repeat(32);
    const header = "b".repeat(32);
    assert.equal(
      csrfRequestAllowed({
        method: "POST",
        fetchSite: "same-origin",
        cookieToken: cookie,
        headerToken: header,
      }),
      false,
    );
  });

  it("accepts double-submit when cookie matches header", () => {
    const t = "c".repeat(32);
    assert.equal(
      csrfRequestAllowed({
        method: "POST",
        fetchSite: "same-origin",
        cookieToken: t,
        headerToken: t,
      }),
      true,
    );
    assert.equal(
      csrfRequestAllowed({
        method: "POST",
        fetchSite: "cross-site",
        cookieToken: t,
        headerToken: t,
      }),
      true,
    );
  });

  it("rejects missing or malformed sent tokens on mutating same-origin requests", () => {
    assert.equal(
      csrfRequestAllowed({
        method: "POST",
        fetchSite: "same-origin",
        cookieToken: null,
        headerToken: null,
      }),
      false,
    );
    assert.equal(
      csrfRequestAllowed({
        method: "POST",
        fetchSite: "same-origin",
        cookieToken: null,
        headerToken: "not-a-nonce",
      }),
      false,
    );
    assert.equal(
      csrfRequestAllowed({
        method: "POST",
        fetchSite: "same-origin",
        cookieToken: null,
        headerToken: "A".repeat(32),
      }),
      false,
    );
  });

  it("rejects when header and RPC context disagree", () => {
    assert.equal(
      csrfRequestAllowed({
        method: "POST",
        fetchSite: "same-origin",
        cookieToken: null,
        headerToken: "a".repeat(32),
        contextToken: "b".repeat(32),
      }),
      false,
    );
    assert.equal(
      csrfRequestAllowed({
        method: "POST",
        fetchSite: "same-origin",
        cookieToken: null,
        headerToken: "a".repeat(32),
        contextToken: "a".repeat(32),
      }),
      true,
    );
  });

  it("prefers the Host cookie over the fallback when both are present", () => {
    const host = "1".repeat(32);
    const fallback = "2".repeat(32);
    assert.equal(
      readCsrfCookie(`${CSRF_COOKIE}=${host}; ${CSRF_COOKIE_FALLBACK}=${fallback}`),
      host,
    );
  });
});
