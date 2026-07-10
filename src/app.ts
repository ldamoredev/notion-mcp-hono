import { Hono } from 'hono';

export function createApp(): Hono {
  const app = new Hono();

  app.get('/health', (c) => c.json({ status: 'ok' }));

  app.notFound((c) => c.json({ error: 'not_found', message: 'Route not found' }, 404));

  return app;
}
