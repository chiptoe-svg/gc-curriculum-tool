import { randomBytes, randomUUID } from 'node:crypto';

export const TOKEN_LENGTH = 32;

/**
 * 32-char URL-safe random token. base64url of 24 random bytes = 32 chars.
 * Cryptographic RNG. Never log raw tokens.
 */
export function generateMagicToken(): string {
  return randomBytes(24).toString('base64url');
}

export function generateSessionId(): string {
  return randomUUID();
}
