import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hashInviteToken, inviteExpiry, newInviteToken } from "./invite.ts";
import { INVITE_TTL_DAYS, isInviteTokenShape } from "./invite-constants.ts";

describe("token de convite", () => {
  it("gera token com o formato que a validacao aceita", () => {
    for (let i = 0; i < 50; i++) assert.equal(isInviteTokenShape(newInviteToken()), true);
  });

  it("tokens nao se repetem", () => {
    const vistos = new Set(Array.from({ length: 200 }, () => newInviteToken()));
    assert.equal(vistos.size, 200);
  });

  it("recusa formatos que nao sao token", () => {
    for (const ruim of ["", "curto", "a".repeat(31), "a".repeat(33), "a".repeat(31) + "/", null, 42, undefined]) {
      assert.equal(isInviteTokenShape(ruim), false, String(ruim));
    }
  });

  it("guarda so o hash: estavel e diferente do token", () => {
    const t = newInviteToken();
    assert.equal(hashInviteToken(t), hashInviteToken(t));
    assert.notEqual(hashInviteToken(t), t);
    assert.notEqual(hashInviteToken(t), hashInviteToken(newInviteToken()));
  });

  it("expira em INVITE_TTL_DAYS dias", () => {
    const agora = new Date("2026-09-23T12:00:00Z");
    const dias = (inviteExpiry(agora).getTime() - agora.getTime()) / 86_400_000;
    assert.equal(dias, INVITE_TTL_DAYS);
  });
});
