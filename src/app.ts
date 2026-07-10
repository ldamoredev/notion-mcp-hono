import { StreamableHTTPTransport } from '@hono/mcp';
import { Hono } from 'hono';
import { bearerAuth } from './auth.js';
import { createMcpServer } from './mcp/server.js';
import type { NotionGateway } from './notion/gateway.js';

export interface AppConfig {
  mcpApiKey: string;
  gateway: NotionGateway;
}

export function createApp({ mcpApiKey, gateway }: AppConfig): Hono {
  const app = new Hono();

  app.get('/health', (c) => c.json({ status: 'ok' }));

  app.use('/mcp', bearerAuth(mcpApiKey));

  // Stateless Streamable HTTP: a fresh server + transport per request, no session
  // map — every request is self-contained, so the app scales horizontally.
  app.post('/mcp', async (c) => {
    const server = createMcpServer(gateway);
    // No sessionIdGenerator → stateless mode (no Mcp-Session-Id issued).
    const transport = new StreamableHTTPTransport();
    await server.connect(transport);
    const res = await transport.handleRequest(c);
    return res ?? c.newResponse(null, 202);
  });

  // No sessions means nothing to stream (GET) or terminate (DELETE).
  app.on(['GET', 'DELETE'], '/mcp', (c) => {
    c.header('Allow', 'POST');
    return c.json(
      {
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed. This stateless server only accepts POST.' },
        id: null,
      },
      405,
    );
  });

  app.notFound((c) => c.json({ error: 'not_found', message: 'Route not found' }, 404));

  return app;
}
