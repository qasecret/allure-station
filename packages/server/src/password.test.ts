import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password hashing", () => {
  it("round-trips a correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("uses a random salt — same password hashes differently", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("returns false on malformed stored values instead of throwing", async () => {
    for (const bad of ["", "plaintext", "scrypt$only-two", "bcrypt$aa$bb"]) {
      expect(await verifyPassword("x", bad)).toBe(false);
    }
  });
});
