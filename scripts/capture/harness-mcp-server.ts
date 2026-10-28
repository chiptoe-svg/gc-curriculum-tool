#!/usr/bin/env tsx
/**
 * Harness spike (2026-10-28): the interviewer's tools as a stdio MCP server,
 * for the Codex loop (lib/ai/agent/harness/codex-interview.ts). Codex starts
 * it per turn from its config. Every call is appended to HARNESS_LOG (tool,
 * args, chunk ids returned) so the host and the hooks can see what was
 * retrieved.
 *
 * Env: HARNESS_COURSE (course code), HARNESS_LOG (jsonl path), DATABASE_URL
 * (must name a scratch database; set by the runner, so .env.local cannot
 * point it at live).
 */
import { appendFileSync } from 'node:fs';
import { loadAppEnv } from '@/scripts/catalog/catalog-source';

async function main() {
  const course = process.env.HARNESS_COURSE;
  const log = process.env.HARNESS_LOG;
  if (!course || !log) throw new Error('HARNESS_COURSE and HARNESS_LOG are required');
  if (!process.env.DATABASE_URL?.includes('scratch')) throw new Error('refusing: DATABASE_URL must name a scratch database');
  loadAppEnv();
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const { buildAuditTools } = await import('@/lib/ai/agent/audit-tools');
  const { renderToolDescription } = await import('@/lib/ai/tool-use-types');
  const { chunkIdsInToolResult } = await import('@/lib/ai/agent/harness/controls');

  const server = new McpServer({ name: 'capture', version: '0.0.1' });
  for (const tool of buildAuditTools(course)) {
    const shape = (tool.inputSchema as unknown as { shape?: Record<string, never> }).shape ?? {};
    server.registerTool(tool.name, { description: renderToolDescription(tool), inputSchema: shape }, async (args: Record<string, unknown>) => {
      const result = await tool.execute(args);
      const ids = new Set<string>();
      chunkIdsInToolResult(result, ids);
      appendFileSync(log, JSON.stringify({ tool: tool.name, args, chunkIds: [...ids] }) + '\n');
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    });
  }
  await server.connect(new StdioServerTransport());
}

void main().catch(err => { console.error(err); process.exit(1); });
