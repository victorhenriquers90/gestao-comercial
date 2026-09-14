import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPasswordCrypto, isEmailPasswordSignIn } from "./password.server.ts";

const crypto = createPasswordCrypto({ N: 16, r: 8, p: 1, dkLen: 32 });

describe("password dummy hash", () => {
  it("round-trips a real hash", async () => {
    const hash = await crypto.hashPassword("loja12345");
    assert.match(hash, /^[a-f0-9]{32}:[a-f0-9]{64}$/);
    assert.equal(await crypto.verifyPassword({ hash, password: "loja12345" }), true);
    assert.equal(await crypto.verifyPassword({ hash, password: "wrong-pass" }), false);
  });

  it("invalid hashes still run the dummy compare and return false", async () => {
    assert.equal(await crypto.verifyPassword({ hash: "", password: "loja12345" }), false);
    assert.equal(await crypto.verifyPassword({ hash: "not-a-hash", password: "loja12345" }), false);
    assert.equal(await crypto.verifyPassword({ hash: "aa:bb", password: "loja12345" }), false);
  });

  it("sign-in miss pad hashes against the dummy instead of minting a new salt", async () => {
    const dummy = await crypto.dummyHash();
    const padded = await crypto.runWithPasswordDummyPad(() => crypto.hashPassword("qualquer-senha"));
    assert.equal(padded, dummy);
    const unique = await crypto.hashPassword("qualquer-senha");
    assert.notEqual(unique, dummy);
    assert.equal(await crypto.verifyPassword({ hash: dummy, password: "qualquer-senha" }), false);
  });

  it("detects the email sign-in route for the dummy pad", () => {
    assert.equal(
      isEmailPasswordSignIn(new Request("http://127.0.0.1/api/auth/sign-in/email", { method: "POST" })),
      true,
    );
    assert.equal(
      isEmailPasswordSignIn(new Request("http://127.0.0.1/api/auth/sign-up/email", { method: "POST" })),
      false,
    );
    assert.equal(
      isEmailPasswordSignIn(new Request("http://127.0.0.1/api/auth/sign-in/email", { method: "GET" })),
      false,
    );
  });
});
