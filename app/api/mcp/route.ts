/**
 * Wiki MCP server endpoint — agent-facing "explain the curriculum" surface.
 *
 * Exposes read_wiki / list_wiki / search_wiki (see lib/ai/wiki/mcp-server.ts)
 * over MCP Streamable HTTP, so any MCP-capable agent on the Clemson internal
 * network can answer class/curriculum questions grounded in the narrative
 * wiki. Read-only.
 *
 * AUTH: a shared bearer token (`WIKI_MCP_TOKEN`), checked before any MCP
 * handling. Fail-closed — if the env var is unset, every request is 401, so
 * the endpoint is never accidentally open. This route is self-authenticating,
 * so it is listed in PUBLIC_PREFIXES (lib/auth/basic-auth.ts) to skip the
 * faculty Basic Auth middleware; the bearer check here is its real gate.
 *
 * EXPOSURE: served by the app on 0.0.0.0:3000 (Clemson LAN). Deliberately NOT
 * mapped onto the public Tailscale Funnel — the wiki is candid internal
 * curriculum analysis (the gc-curriculum-wiki repo is private). See
 * docs/superpowers/specs/2026-06-09-wiki-mcp-server-design.md.
 *
 * TRANSPORT: WebStandardStreamableHTTPServerTransport in STATELESS mode
 * (sessionIdGenerator omitted). A stateless transport is single-use — it
 * cannot be reused across requests — so we build a FRESH server+transport per
 * request and let each request be a fully independent JSON-RPC exchange. The
 * wiki tools are read-only and idempotent, so per-request isolation is exactly
 * what we want; there is no session state to keep.
 */

import { NextResponse } from 'next/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { authorizedForBearer } from '@/lib/auth/bearer';
import { buildWikiMcpServer } from '@/lib/ai/wiki/mcp-server';

// The wiki reader uses node:fs; the transport uses node crypto. Edge runtime
// lacks these.
export const runtime = 'nodejs';

async function handle(req: Request): Promise<Response> {
  if (!authorizedForBearer(req.headers.get('authorization'), process.env.WIKI_MCP_TOKEN)) {
    return new NextResponse('Unauthorized', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Bearer realm="gc-curriculum-wiki"' },
    });
  }
  // Fresh server + stateless transport per request (stateless transports are
  // single-use). Each request is an independent, isolated JSON-RPC exchange.
  const server = buildWikiMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
