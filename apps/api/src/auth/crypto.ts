import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

/**
 * Passwords: scrypt (memory-hard) with a per-password salt. The parameters are stored with
 * the hash, so the cost can be raised later without invalidating existing passwords.
 * Format: scrypt$N$r$p$salt$key (base64url).
 */

const KEY_LENGTH = 64;

function scrypt(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, KEY_LENGTH, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

function options(cost: number, blockSize: number, parallelism: number): ScryptOptions {
  // scrypt needs 128 * N * r bytes; leave headroom over Node's 32 MiB default.
  return { N: cost, r: blockSize, p: parallelism, maxmem: 256 * cost * blockSize };
}

export async function hashPassword(password: string, cost: number): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, options(cost, 8, 1));
  return ["scrypt", cost, 8, 1, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, key] = stored.split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !salt || !key) return false;
  const expected = Buffer.from(key, "base64url");
  const actual = await scrypt(
    password.normalize("NFKC"),
    Buffer.from(salt, "base64url"),
    options(Number(n), Number(r), Number(p)),
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Session and invitation tokens: 256 random bits. Only their SHA-256 is stored. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
