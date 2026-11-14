function hostOf(value: string): string | null {
  try { return new URL(value).host; } catch { return null; }
}

/** True when a state-changing request looks cross-site. A copy of the test in middleware.ts,
 * for routes the middleware matcher excludes. Keep the two in sync. Does not look at the
 * method: callers skip it for GET/HEAD. */
export function isCrossSiteRequest(req: Request): boolean {
  const secFetchSite = req.headers.get('sec-fetch-site');
  if (secFetchSite === 'cross-site' || secFetchSite === 'same-site') return true;
  const origin = req.headers.get('origin');
  if (!origin) return false;
  const originHost = hostOf(origin);
  const requestHost = req.headers.get('host') ?? new URL(req.url).host;
  const publicHost = process.env.PUBLIC_HTTPS_ORIGIN ? hostOf(process.env.PUBLIC_HTTPS_ORIGIN) : null;
  return !(originHost && (originHost === requestHost || (publicHost && originHost === publicHost)));
}
