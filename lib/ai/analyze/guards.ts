import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { checkDailyCap } from '@/lib/rate-limit/daily-cap';

export interface GuardOutcome {
  short: NextResponse | null;
  ipHash: string;
}

function hashIp(req: Request): string {
  // On Vercel (and most reverse proxies), the trusted client IP is the LAST
  // entry in X-Forwarded-For — the proxy appends it. Taking [0] would let a
  // client spoof the IP via their own forwarded header and bypass rate limits.
  const xff = req.headers.get('x-forwarded-for');
  const parts = xff?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
  const ip = parts[parts.length - 1] ?? req.headers.get('x-real-ip') ?? 'unknown';
  return createHash('sha256').update(ip).digest('hex');
}

export async function applyAnalyzeGuards(req: Request): Promise<GuardOutcome> {
  const ipHash = hashIp(req);
  const rl = await checkIpRateLimit(ipHash);
  if (!rl.allowed) {
    return { short: NextResponse.json({ error: 'rate limit exceeded — try again in an hour' }, { status: 429 }), ipHash };
  }
  const cap = await checkDailyCap();
  if (!cap.ok) {
    return { short: NextResponse.json({ error: 'daily cost cap reached — service paused for today' }, { status: 503 }), ipHash };
  }
  return { short: null, ipHash };
}
