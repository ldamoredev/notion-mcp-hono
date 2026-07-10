import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export const SERVER_INFO = { name: 'notion-mcp-hono', version: '0.1.0' } as const;

export function createMcpServer(): McpServer {
  const server = new McpServer(SERVER_INFO, {
    capabilities: { tools: {} },
  });

  // Placeholder tool proving the wiring end-to-end; replaced by Notion tools in phase 5.
  server.registerTool(
    'ping',
    {
      description:
        'Health-check tool. Echoes the message you send back as "pong: <message>". ' +
        'Use it to verify the connection to this server works.',
      inputSchema: {
        message: z.string().describe('Any text to echo back.'),
      },
    },
    async ({ message }) => ({
      content: [{ type: 'text', text: `pong: ${message}` }],
    }),
  );

  return server;
}
