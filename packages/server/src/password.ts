import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);
const KEYLEN = 32;

/** Hash a password with scrypt + a per-user random salt. Format: `scrypt$<saltHex>$<hashHex>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = (await scrypt(password, salt, KEYLEN)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/** Constant-time verify against a stored `scrypt$salt$hash` string. False on any malformed input. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  if (salt.length === 0 || expected.length !== KEYLEN) return false;
  const actual = (await scrypt(password, salt, KEYLEN)) as Buffer;
  return timingSafeEqual(actual, expected);
}
