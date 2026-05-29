import { authenticator } from "otplib";
import QRCode from "qrcode";
import { env } from "../config/env.js";

/**
 * TOTP (RFC 6238) helpers for 2FA, backed by otplib. The raw base32 secret is
 * sensitive and is encrypted at rest by the caller (utils/crypto); this module
 * only deals with the plaintext secret in memory.
 */

/** A fresh base32 secret to seed an authenticator app. */
export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

/** otpauth:// URI to encode in a QR code (issuer + account label). */
export function totpKeyUri(accountEmail: string, secret: string): string {
  return authenticator.keyuri(accountEmail, env.TOTP_ISSUER, secret);
}

/** Render the otpauth URI as a data: URL PNG for an <img> tag. */
export function totpQrDataUrl(otpauthUri: string): Promise<string> {
  return QRCode.toDataURL(otpauthUri);
}

/** Verify a 6-digit code against the secret (±1 step window via otplib default). */
export function verifyTotp(token: string, secret: string): boolean {
  try {
    return authenticator.verify({ token: token.trim(), secret });
  } catch {
    return false;
  }
}
