import { StreamableHTTPTransport } from '@hono/mcp';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { bearerAuth } from './auth.js';
import type { Logger } from './logger.js';
import { silentLogger } from './logger.js';
import { createMcpServer } from './mcp/server.js';
import type { NotionGateway } from './notion/gateway.js';

export interface AppConfig {
  mcpApiKey: string;
  gateway: NotionGateway;
  logger?: Logger;
}

const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MiB: fits the 500k-char markdown limit with JSON overhead

export function createApp({ mcpApiKey, gateway, logger = silentLogger }: AppConfig): Hono {
  const app = new Hono();

  app.get('/health', (c) => c.json({ status: 'ok' }));

  // Request log for everything except /health (Railway polls it constantly).
  app.use(async (c, next) => {
    if (c.req.path === '/health') return next();
    const start = performance.now();
    await next();
    logger.info('http_request', {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Math.round(performance.now() - start),
    });
  });

  app.use('/mcp', bearerAuth(mcpApiKey));
  app.use(
    '/mcp',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) =>
        c.json({ error: 'payload_too_large', message: 'Request body exceeds 2 MiB.' }, 413),
    }),
  );

  // Stateless Streamable HTTP: a fresh server + transport per request, no session
  // map — every request is self-contained, so the app scales horizontally.
  app.post('/mcp', async (c) => {
    const server = createMcpServer(gateway, logger);
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

  // Public landing page + assets. Paths resolve against the process cwd (the
  // repo root both locally and on Railway), so public/ ships as-is, uncompiled.
  app.get('/', serveStatic({ path: './public/index.html' }));
  app.get('/static/*', serveStatic({ root: './public' }));

  app.notFound((c) => c.json({ error: 'not_found', message: 'Route not found' }, 404));

  return app;
}
