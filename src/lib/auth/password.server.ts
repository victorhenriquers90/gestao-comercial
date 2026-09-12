/**
 * Password hashing compatible with Better Auth's default scrypt format
 * (`saltHex:keyHex`) plus two timing fixes:
 *
 * 1. Verify uses `crypto.timingSafeEqual` on the derived bytes (not `===` on hex).
 * 2. Sign-in miss (Better Auth calls `hash()` when the user/credential is
 *    missing) is wrapped in `runWithPasswordDummyPad` so it runs the same
 *    scrypt+compare path against a process-stable dummy hash instead of
 *    minting a new salt.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/** Same parameters as `@better-auth/utils/password`. */
export const PASSWORD_SCRYPT = {
  N: 16384,
  r: 16,
  p: 1,
  dkLen: 64,
} as const;

export type PasswordCrypto = {
  hashPassword: (password: string) => Promise<string>;
  verifyPassword: (data: { hash: string; password: string }) => Promise<boolean>;
  runWithPasswordDummyPad: <T>(fn: () => T) => T;
  dummyHash: () => Promise<string>;
};

export type PasswordCryptoOptions = {
  N?: number;
  r?: number;
  p?: number;
  dkLen?: number;
  /** Persist dummy hash across HMR. Default off (tests). */
  persistDummy?: boolean;
};

type GlobalDummy = typeof globalThis & { __gcDummyPasswordHash__?: Promise<string> };

function scryptKey(
  password: string,
  salt: string,
  opts: { N: number; r: number; p: number; dkLen: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      opts.dkLen,
      {
        N: opts.N,
        r: opts.r,
        p: opts.p,
        maxmem: 128 * opts.N * opts.r * 2,
      },
      (err, key) => {
        if (err) reject(err);
        else resolve(key);
      },
    );
  });
}

function parseHash(hash: string | null | undefined, dkLen: number): { salt: string; key: Buffer } | null {
  if (typeof hash !== "string") return null;
  const split = hash.indexOf(":");
  if (split <= 0) return null;
  const salt = hash.slice(0, split);
  const keyHex = hash.slice(split + 1);
  if (salt.length !== 32 || keyHex.length !== dkLen * 2) return null;
  for (let i = 0; i < salt.length; i++) {
    const c = salt.charCodeAt(i);
    if (!((c >= 48 && c <= 57) || (c >= 97 && c <= 102))) return null;
  }
  for (let i = 0; i < keyHex.length; i++) {
    const c = keyHex.charCodeAt(i);
    if (!((c >= 48 && c <= 57) || (c >= 97 && c <= 102))) return null;
  }
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== dkLen) return null;
  return { salt, key };
}

export function createPasswordCrypto(options: PasswordCryptoOptions = {}): PasswordCrypto {
  const opts = {
    N: options.N ?? PASSWORD_SCRYPT.N,
    r: options.r ?? PASSWORD_SCRYPT.r,
    p: options.p ?? PASSWORD_SCRYPT.p,
    dkLen: options.dkLen ?? PASSWORD_SCRYPT.dkLen,
  };
  const dummyPad = new AsyncLocalStorage<true>();
  let localDummy: Promise<string> | null = null;

  function dummyHash(): Promise<string> {
    if (options.persistDummy) {
      const g = globalThis as GlobalDummy;
      g.__gcDummyPasswordHash__ ??= mintDummy();
      return g.__gcDummyPasswordHash__;
    }
    localDummy ??= mintDummy();
    return localDummy;
  }

  async function mintDummy(): Promise<string> {
    const salt = randomBytes(16).toString("hex");
    const secret = randomBytes(32).toString("hex");
    const key = await scryptKey(secret, salt, opts);
    return `${salt}:${key.toString("hex")}`;
  }

  async function compare(password: string, hash: string): Promise<boolean> {
    const dummy = parseHash(await dummyHash(), opts.dkLen);
    if (!dummy) return false;
    const parsed = parseHash(hash, opts.dkLen);
    const salt = parsed?.salt ?? dummy.salt;
    const expected = parsed?.key ?? dummy.key;
    const derived = await scryptKey(password, salt, opts);
    const compareTo = expected.length === derived.length ? expected : dummy.key;
    const padded = compareTo.length === derived.length ? compareTo : Buffer.alloc(derived.length);
    const bytesEqual = timingSafeEqual(derived, padded);
    return parsed !== null && expected.length === derived.length && bytesEqual;
  }

  async function hashPassword(password: string): Promise<string> {
    if (dummyPad.getStore()) {
      const dummy = await dummyHash();
      await compare(password, dummy);
      return dummy;
    }
    const salt = randomBytes(16).toString("hex");
    const key = await scryptKey(password, salt, opts);
    return `${salt}:${key.toString("hex")}`;
  }

  async function verifyPassword(data: { hash: string; password: string }): Promise<boolean> {
    return compare(data.password, data.hash);
  }

  function runWithPasswordDummyPad<T>(fn: () => T): T {
    return dummyPad.run(true, fn);
  }

  return { hashPassword, verifyPassword, runWithPasswordDummyPad, dummyHash };
}

const passwords = createPasswordCrypto({ persistDummy: true });

export const hashPassword = passwords.hashPassword;
export const verifyPassword = passwords.verifyPassword;
export const runWithPasswordDummyPad = passwords.runWithPasswordDummyPad;

export function isEmailPasswordSignIn(request: Request): boolean {
  if (request.method.toUpperCase() !== "POST") return false;
  try {
    const path = new URL(request.url).pathname.replace(/\/+$/, "");
    return path.endsWith("/sign-in/email");
  } catch {
    return false;
  }
}
