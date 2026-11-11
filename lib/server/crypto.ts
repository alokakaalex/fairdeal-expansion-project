import "server-only";
import { createHash, randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";

// Passwords: scrypt with a per-password random salt, stored as
// "scrypt$N$r$p$salt$hash". Tokens (sessions, invite links) are random and
// only their SHA-256 is stored, so a database leak can't be replayed.

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

function encode(salt: Buffer, hash: Buffer) {
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function hashPasswordSync(password: string): string {
  const salt = randomBytes(16);
  return encode(salt, scryptSync(password, salt, KEYLEN, { N, r: R, p: P }));
}

export function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEYLEN, { N, r: R, p: P }, (err, hash) =>
      err ? reject(err) : resolve(encode(salt, hash)),
    ),
  );
}

export function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  // Still do the work for unknown users so response time doesn't reveal
  // which emails have accounts.
  const parts = (stored ?? "").split("$");
  const valid = parts.length === 6 && parts[0] === "scrypt";
  const [n, r, p] = valid ? parts.slice(1, 4).map(Number) : [N, R, P];
  const salt = valid ? Buffer.from(parts[4], "base64url") : randomBytes(16);
  const expected = valid ? Buffer.from(parts[5], "base64url") : randomBytes(KEYLEN);
  return new Promise((resolve, reject) =>
    scrypt(password, salt, expected.length, { N: n, r, p }, (err, hash) =>
      err ? reject(err) : resolve(valid && timingSafeEqual(hash, expected)),
    ),
  );
}

export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
