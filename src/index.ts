import { serve } from '@hono/node-server';
import { createApp } from './app.js';

const mcpApiKey = process.env.MCP_API_KEY;
if (!mcpApiKey) {
  console.error('Fatal: the MCP_API_KEY environment variable must be set (see .env.example).');
  process.exit(1);
}

const port = Number(process.env.PORT ?? 3000);

serve({ fetch: createApp({ mcpApiKey }).fetch, port }, (info) => {
  console.log(`notion-mcp-hono listening on http://localhost:${info.port}`);
});
