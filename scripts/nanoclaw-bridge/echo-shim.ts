#!/usr/bin/env bun
/**
 * Echo MCP shim — tracer-smoke standalone for the CourseCapture × nanoclaw
 * bridge negotiation. Single tool `echo({ message }) → { reply: message }`.
 * Speaks JSON-RPC over stdio; intended to be mounted into a nanoclaw agent
 * container via the agent group's `additionalMounts` config and invoked as
 * the `command` of an MCP server entry.
 *
 * Replaced by the real CourseCapture MCP server (list_materials,
 * fetch_material_section, search_materials) once the tracer round-trip is
 * confirmed.
 *
 * Build:  bun build --compile --outfile echo-shim ./echo-shim.ts
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
  { name: 'coursecapture-echo-shim', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'echo',
      description:
        'Tracer-smoke tool. Returns the message you sent back as { reply: <message> }. Confirms end-to-end round-trip through the nanoclaw agent → stdio shim → response path.',
      inputSchema: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'The text to echo back.',
          },
        },
        required: ['message'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'echo') {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }
  const args = (request.params.arguments ?? {}) as { message?: unknown };
  if (typeof args.message !== 'string') {
    throw new Error('echo: `message` must be a string');
  }
  return {
    content: [{ type: 'text', text: JSON.stringify({ reply: args.message }) }],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
