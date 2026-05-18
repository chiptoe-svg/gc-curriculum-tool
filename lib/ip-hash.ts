import { createHash } from 'node:crypto';

/**
 * Extracts the trusted client IP from the request and returns a SHA-256 hash.
 * On Vercel (and most reverse proxies), the trusted client IP is the LAST
 * entry in X-Forwarded-For — the proxy appends it. Taking [0] would let a
 * client spoof the IP via their own forwarded header and bypass rate limits.
 */
export function hashIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  const parts = xff?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  const ip = parts[parts.length - 1] ?? req.headers.get('x-real-ip') ?? 'unknown';
  return createHash('sha256').update(ip).digest('hex');
}
