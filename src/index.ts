import { serve } from '@hono/node-server';
import { Client } from '@notionhq/client';
import { createApp } from './app.js';
import { createNotionGateway } from './notion/client.js';

const mcpApiKey = process.env.MCP_API_KEY;
if (!mcpApiKey) {
  console.error('Fatal: the MCP_API_KEY environment variable must be set (see .env.example).');
  process.exit(1);
}

const notionToken = process.env.NOTION_TOKEN;
if (!notionToken) {
  console.error('Fatal: the NOTION_TOKEN environment variable must be set (see .env.example).');
  process.exit(1);
}

const port = Number(process.env.PORT ?? 3000);
const gateway = createNotionGateway(new Client({ auth: notionToken }));

serve({ fetch: createApp({ mcpApiKey, gateway }).fetch, port }, (info) => {
  console.log(`notion-mcp-hono listening on http://localhost:${info.port}`);
});
