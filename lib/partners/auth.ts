import { findPartnerByToken, findPartnerById } from './queries';
import { lookupSession, SESSION_COOKIE } from './sessions';

export interface ResolvedPartner {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  active: boolean;
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get('cookie');
  if (!raw) return null;
  for (const piece of raw.split(';')) {
    const [k, ...rest] = piece.trim().split('=');
    if (k === name) return rest.join('=') || null;
  }
  return null;
}

/**
 * Resolves the partner for an API request.
 *
 * Order of precedence: URL token first (the link is the source of truth),
 * then session cookie (bookmark / SPA navigation). Inactive partners always
 * resolve to null regardless of credential.
 */
export async function resolvePartner(req: Request, urlToken: string | null): Promise<ResolvedPartner | null> {
  if (urlToken) {
    const p = await findPartnerByToken(urlToken);
    if (!p || !p.active) return null;
    return p as ResolvedPartner;
  }
  const sessionId = readCookie(req, SESSION_COOKIE);
  if (!sessionId) return null;
  const session = await lookupSession(sessionId);
  if (!session) return null;
  const p = await findPartnerById(session.partnerId);
  if (!p || !p.active) return null;
  return p as ResolvedPartner;
}
