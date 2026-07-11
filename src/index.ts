import { serve } from '@hono/node-server';
import { Client } from '@notionhq/client';
import { createApp } from './app.js';
import { createLogger } from './logger.js';
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

// Optional: powers the public playground (/demo/*) against a dedicated demo
// workspace. When unset the demo routes respond 503 and everything else works.
const demoNotionToken = process.env.DEMO_NOTION_TOKEN;

const port = Number(process.env.PORT ?? 3000);
const gateway = createNotionGateway(new Client({ auth: notionToken }));
const demoGateway = demoNotionToken
  ? createNotionGateway(new Client({ auth: demoNotionToken }))
  : undefined;
const logger = createLogger();

const app = createApp({
  mcpApiKey,
  gateway,
  ...(demoGateway !== undefined && { demoGateway }),
  logger,
});

serve({ fetch: app.fetch, port }, (info) => {
  logger.info('server_started', { port: info.port, demoEnabled: demoGateway !== undefined });
});
