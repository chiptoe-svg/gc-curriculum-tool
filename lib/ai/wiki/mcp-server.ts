/**
 * Wiki MCP server — the agent-facing "explain the curriculum" surface.
 *
 * Wraps the SAME tools the in-app /ask agent uses — the three narrative read
 * tools (`buildCurriculumChatTools()` → read_wiki / list_wiki / search_wiki)
 * plus the typed-graph query tools (`buildCurriculumGraphTools()` →
 * coverage_for_target / prereq_chain) — as an MCP server, so any MCP-capable
 * agent can answer class/curriculum questions grounded in the narrative wiki
 * and the typed coverage/prerequisite graph. Read-only by construction; the
 * narrative tools inherit their path-traversal guard and `raw/` exclusion (no
 * snapshot JSON, no transcripts) and the graph tools are read-only DB queries.
 * Served over Streamable HTTP from `app/api/mcp/route.ts`.
 *
 * The builder takes the tool list as a parameter (defaulting to the real
 * tools) so it can be exercised with fakes in tests without touching the
 * filesystem.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';
import { buildCurriculumChatTools } from '@/lib/ai/wiki/tools';
import { buildCurriculumGraphTools } from '@/lib/ai/wiki/graph-tools';
import { buildCurriculumSearchTools } from '@/lib/ai/wiki/curriculum-search-tool';
import { renderToolDescription, type ToolDefinition } from '@/lib/ai/tool-use-types';

const SERVER_INFO = { name: 'gc-curriculum-wiki', version: '1.0.0' } as const;

/**
 * Pull the raw Zod shape from a tool's input schema for `registerTool`. Every
 * wiki tool uses `z.object({...})`, which exposes `.shape`. Duck-typed rather
 * than `instanceof z.ZodObject` to stay robust across Zod major versions.
 */
function rawShape(schema: ToolDefinition['inputSchema']): z.ZodRawShape {
  const s = schema as unknown as { shape?: z.ZodRawShape };
  return s.shape ?? {};
}

export function buildWikiMcpServer(
  tools: ToolDefinition[] = [...buildCurriculumChatTools(), ...buildCurriculumGraphTools(), ...buildCurriculumSearchTools()],
): McpServer {
  const server = new McpServer(SERVER_INFO);

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: renderToolDescription(tool),
        inputSchema: rawShape(tool.inputSchema),
      },
      async (args: Record<string, unknown>) => {
        const result = await tool.execute(args);
        // The wiki tools return plain JSON-able objects ({content,path} /
        // {pages} / {hits} or {error}). Hand them back as a single JSON text
        // block — the agent's model reads the structured payload.
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      },
    );
  }

  return server;
}
