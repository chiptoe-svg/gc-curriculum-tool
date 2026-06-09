# Wiki MCP Server — agent-facing curriculum explainer (Design)

> **Status:** design, 2026-06-09 — approved in dialogue, building.
> **Author:** drafted with Claude, 2026-06-09
> **Relates:** `lib/ai/wiki/tools.ts` · `lib/wiki/git-ops.ts` · `middleware.ts` · `lib/auth/basic-auth.ts`

---

## Why this exists

The narrative wiki (`gc-curriculum-wiki` → `courses/ · competencies/ · targets/ · concepts/ · index.md`) is the curriculum's living "what's in here" record. Today only the in-app `/ask` agent (`lib/ai/wiki/chat.ts`) can read it, via `buildCurriculumChatTools()`. We want **other agents** — e.g. nanoclaw and any agent on the Clemson internal network — to answer questions about a class or the curriculum grounded in that same wiki.

This is **core curriculum-tool functionality** (the programmatic "explain the curriculum to others" surface), not a side project — so it ships *in* this repo and deploys with the tool, reusing the existing tools rather than copying them.

## What it is

A **Model Context Protocol (MCP) server** mounted as a Next App Router route — `app/api/mcp` — exposing the three existing read tools over **Streamable HTTP**:

- `read_wiki(path)` — one narrative page
- `list_wiki(type?)` — enumerate pages
- `search_wiki(query)` — full-text with snippets

It wraps `buildCurriculumChatTools()` directly (DRY — no copy), so it inherits the path-traversal guard and the **`raw/` exclusion** (no immutable snapshot JSON, no interview transcripts). Read-only, FERPA-safe (narrative prose only).

## Architecture

- **Transport:** `WebStandardStreamableHTTPServerTransport` from `@modelcontextprotocol/sdk` (1.29) — a Web-Fetch (`Request`/`Response`) transport that drops straight into an App Router handler: `POST(req) → transport.handleRequest(req)`. **Stateless** (`sessionIdGenerator` omitted) — every request is an independent JSON-RPC call; no session store. No new dependency, no Node-bridge.
- **Server build:** `lib/ai/wiki/mcp-server.ts` exposes `buildWikiMcpServer()`, which creates an `McpServer` and `registerTool`s each of the three tools (mapping `ToolDefinition.inputSchema.shape` → the tool's Zod shape; the handler calls the tool's `execute` and returns the result as a JSON text content block). Pure + testable: the builder takes the tool list, so a test can assert the three tools register and a call round-trips.
- **Route:** `app/api/mcp/route.ts`, `runtime = 'nodejs'` (the wiki reader uses `node:fs`). Handles `POST` (and `GET`/`DELETE` as the transport requires). Bearer check first, then hand to the transport.

## Auth

- **Credential:** a single shared **bearer token**, `WIKI_MCP_TOKEN` (env). Deliberately *separate* from `FACULTY_BASIC_AUTH` so agents never hold the faculty human password and can be revoked independently.
- **Presented by** the agent as `Authorization: Bearer <token>` on every request (configured in the agent's MCP client as `url` + `headers`).
- **Checked** in the route with a constant-time compare before any MCP handling. **Fail-closed:** if `WIKI_MCP_TOKEN` is unset, deny everything (never an open endpoint).
- **Middleware:** `/api/mcp` is added to `PUBLIC_PREFIXES` (it is *self-authenticating* via the bearer token), so the faculty Basic Auth gate skips it and the route owns its auth — mirroring how `PUBLIC_PREFIXES` already treats `/api/partners`.

## Exposure

- Bound on the existing app (`0.0.0.0:3000`), reachable on the **Clemson internal network** at `http://<mac-lan-ip>:3000/api/mcp`.
- **No Tailscale Funnel mapping** — never on the public internet. The wiki is candid internal gap/quality analysis (the `gc-curriculum-wiki` repo is kept private); the bearer token is the access control on the broad shared LAN.
- **Caveat (accepted, matches existing faculty Basic Auth):** token rides in cleartext over plain HTTP on the LAN. TLS-on-LAN (a trusted cert) is a later upgrade if required.

## Non-goals

- No per-agent tokens yet (one shared token; per-agent allowlist is a documented later step if revocation granularity is needed).
- No OAuth 2.1 (MCP's spec flow) — overkill for a few trusted internal agents; revisit only if this goes public/multi-org.
- No write tools — read-only by construction.
- No new MCP resources/prompts — just the three tools.

## Testing

- `bearer` auth: valid → pass; wrong/missing → 401; **`WIKI_MCP_TOKEN` unset → 401 (fail-closed).**
- `buildWikiMcpServer()`: registers exactly the three tools; a `search_wiki` / `read_wiki` call round-trips to wiki content (against a temp fixture wiki dir via `WIKI_REPO_PATH`).
