import { createHash, randomBytes } from "node:crypto";
import { INVITE_TTL_DAYS } from "./invite-constants.ts";

// So servidor (node:crypto). O que o navegador pode ver mora em
// invite-constants.ts.

export function newInviteToken(): string {
  return randomBytes(24).toString("base64url");
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function inviteExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000);
}
