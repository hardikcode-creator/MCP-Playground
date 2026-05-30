/**
 * Minimal stdio MCP server for deterministic, offline tests.
 *
 * Exposes two tools that mirror the public `@modelcontextprotocol/server-everything`
 * shapes the example workflows use:
 *   - echo(message: string) -> { content: [{ type: "text", text: "Echo: <message>" }] }
 *   - add(a: number, b: number) -> { content: [{ type: "text", text: "<a+b>" }] }
 *
 * Spawned by the ClientManager as a child process (e.g. via tsx). Keep it free
 * of any project imports so it runs standalone under tsx/node.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'everything', version: '0.0.1' });

server.registerTool(
  'echo',
  {
    description: 'Echo back the given message.',
    inputSchema: { message: z.string().describe('Text to echo back') },
  },
  async ({ message }) => ({
    content: [{ type: 'text' as const, text: `Echo: ${message}` }],
  }),
);

server.registerTool(
  'add',
  {
    description: 'Add two numbers and return the sum as text.',
    inputSchema: { a: z.number(), b: z.number() },
  },
  async ({ a, b }) => ({
    content: [{ type: 'text' as const, text: String(a + b) }],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
