/**
 * AES-256-GCM for secrets stored in the database (platform sign-ins). The key lives only in
 * server env (CREDENTIALS_ENCRYPTION_KEY, 64 hex chars), so a database leak alone reveals nothing.
 * Format: "v1.<iv>.<tag>.<ciphertext>", each part base64url.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const keyFrom = (hex: string) => {
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) throw new Error("CREDENTIALS_ENCRYPTION_KEY must be 32 bytes (64 hex characters)");
  return key;
};

export function encryptSecret(plain: string, keyHex: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(keyHex), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), data].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

/** Throws if the value was altered or encrypted with another key. */
export function decryptSecret(stored: string, keyHex: string): string {
  const [version, iv, tag, data] = stored.split(".");
  if (version !== "v1" || !iv || !tag || data === undefined) throw new Error("Unknown secret format");
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(keyHex), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
