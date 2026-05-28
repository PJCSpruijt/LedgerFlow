import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../config/env.js";

/**
 * AES-256-GCM encryption for accounting credentials at rest.
 * Format stored in DB: base64(iv || authTag || ciphertext)
 *
 * Why GCM: authenticated encryption — detects tampering in addition to confidentiality.
 * Why a single key: simplifies the MVP. Rotate by re-encrypting all rows with the new key.
 */
const ALGO = "aes-256-gcm";
const KEY = Buffer.from(env.CREDENTIAL_ENCRYPTION_KEY, "hex");
const IV_LEN = 12;
const TAG_LEN = 16;

export function encryptString(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decryptString(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function encryptJson<T>(payload: T): string {
  return encryptString(JSON.stringify(payload));
}

export function decryptJson<T>(payload: string): T {
  return JSON.parse(decryptString(payload)) as T;
}
