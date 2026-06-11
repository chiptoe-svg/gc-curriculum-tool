import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildWikiMcpServer } from '@/lib/ai/wiki/mcp-server';
import type { ToolDefinition } from '@/lib/ai/tool-use-types';

/**
 * Round-trip the builder through a real in-memory MCP client/server pair with
 * FAKE tools — this exercises the registration + execute→content mapping
 * deterministically, without depending on the wiki filesystem (the real wiki
 * tools are covered by their own tests).
 */
const fakeTools: ToolDefinition[] = [
  {
    name: 'echo_page',
    description: 'Echo a page path back.',
    inputSchema: z.object({ path: z.string() }),
    execute: async (args) => ({ content: `read:${(args as { path: string }).path}` }),
  },
  {
    name: 'count_query',
    description: 'Return the length of a query.',
    inputSchema: z.object({ query: z.string() }),
    execute: async (args) => ({ n: (args as { query: string }).query.length }),
  },
];

async function connectedClient(tools?: ToolDefinition[]) {
  const server = buildWikiMcpServer(tools);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
  return { client, server };
}

describe('buildWikiMcpServer', () => {
  it('registers exactly the provided tools', async () => {
    const { client } = await connectedClient(fakeTools);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['count_query', 'echo_page']);
  });

  it('round-trips a tool call: execute result comes back as a JSON text block', async () => {
    const { client } = await connectedClient(fakeTools);
    const res = await client.callTool({ name: 'echo_page', arguments: { path: 'courses/gc-3460.md' } });
    const content = res.content as Array<{ type: string; text: string }>;
    expect(content).toHaveLength(1);
    const text = content[0]!;
    expect(text.type).toBe('text');
    expect(JSON.parse(text.text)).toEqual({ content: 'read:courses/gc-3460.md' });
  });

  it('exposes the real wiki + typed-graph tools by default', async () => {
    const { client } = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'coverage_for_target',
      'list_wiki',
      'prereq_chain',
      'read_wiki',
      'search_wiki',
    ]);
  });
});
