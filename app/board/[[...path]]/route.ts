/**
 * /board — the progress + big-picture dashboards, served THROUGH the app.
 *
 * Why here and not a Caddy file_server: the dashboards are published by
 * ~/.claude/dashboard/sync.sh into /usr/local/gc-caddy/dashboard/<project>/
 * (admin-writable), and serving them from the app means (1) the existing
 * faculty Basic Auth gate in middleware protects them with zero extra config,
 * and (2) no root-owned Caddyfile edit — the owner can deploy this remotely.
 * (A Caddy `/dashboard/` block exists but is broken — 308 loop + stale hash —
 * and needs sudo to remove; this path deliberately avoids it.)
 *
 * Paths:  /board                     → the project index
 *         /board/<project>           → that project's page
 *         /board/<project>/<file>    → state.json | roadmap.md
 * Every segment is allow-listed; nothing outside the served dir is reachable.
 */
import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const dynamic = 'force-dynamic';

const ROOT = process.env.DASHBOARD_DIR ?? '/usr/local/gc-caddy/dashboard';
const PROJECT_RE = /^[a-z0-9-]{1,40}$/;
const FILES: Record<string, string> = {
  'index.html': 'text/html; charset=utf-8',
  'state.json': 'application/json; charset=utf-8',
  'roadmap.md': 'text/markdown; charset=utf-8',
};

function withBase(html: string, base: string): string {
  // The builder's page fetches ./state.json and ./roadmap.md; Next strips the
  // trailing slash from /board/<project>/, which would make those resolve one
  // level up. A <base> pins them regardless of how the URL was typed.
  return html.replace(/<head([^>]*)>/i, `<head$1><base href="${base}">`);
}

export async function GET(_req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path: segs = [] } = await ctx.params;
  if (segs.length > 2) return new NextResponse('Not found', { status: 404 });

  const [project, file = 'index.html'] = segs;
  const type = FILES[file];
  if (!type || (project !== undefined && !PROJECT_RE.test(project))) {
    return new NextResponse('Not found', { status: 404 });
  }
  if (project === undefined && file !== 'index.html') return new NextResponse('Not found', { status: 404 });

  const target = project ? path.join(ROOT, project, file) : path.join(ROOT, 'index.html');
  if (!target.startsWith(ROOT + path.sep)) return new NextResponse('Not found', { status: 404 });

  let body: string;
  try {
    body = await fs.readFile(target, 'utf8');
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
  if (file === 'index.html') body = withBase(body, project ? `/board/${project}/` : '/board/');
  return new NextResponse(body, {
    status: 200,
    headers: { 'content-type': type, 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
  });
}
