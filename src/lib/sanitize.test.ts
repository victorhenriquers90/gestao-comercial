import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  optionalLine,
  requireLine,
  sanitizeCode,
  sanitizeHttpUrl,
  sanitizeLine,
  sanitizeMultiline,
} from "./sanitize.ts";

describe("sanitize input", () => {
  it("strips tags and controls from a name", () => {
    assert.equal(sanitizeLine("  Camiseta\u0000 <script>x</script> Azul  "), "Camiseta x Azul");
    assert.equal(requireLine("Peça", "Nome"), "Peça");
    assert.throws(() => requireLine("   ", "Nome"));
  });

  it("keeps newlines in notes, drops tags", () => {
    assert.equal(sanitizeMultiline("linha 1\n<script>z</script>\nlinha 2"), "linha 1\nz\nlinha 2");
    assert.equal(sanitizeMultiline("   "), null);
  });

  it("rejects javascript and protocol-relative URLs", () => {
    assert.equal(sanitizeHttpUrl("javascript:alert(1)"), null);
    assert.equal(sanitizeHttpUrl("data:text/html,x"), null);
    assert.equal(sanitizeHttpUrl("//evil.test/x"), null);
    assert.equal(sanitizeHttpUrl("/login-store.jpg"), "/login-store.jpg");
    assert.ok(sanitizeHttpUrl("https://cdn.example/a.png")?.startsWith("https://"));
    assert.equal(optionalLine(""), null);
    assert.equal(sanitizeCode("  789123  "), "789123");
  });
});
