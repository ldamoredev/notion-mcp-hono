/**
 * Local UI preview: serves the app with an in-memory demo gateway so the
 * playground works end-to-end with no Notion tokens. Not used in production.
 *
 *   npx tsx scripts/preview.ts   # http://localhost:3123
 */
import { serve } from '@hono/node-server';
import { createApp } from '../src/app.js';
import type { NotionGateway } from '../src/notion/gateway.js';
import { NotionError } from '../src/notion/gateway.js';

const pages = [
  {
    id: '11111111-2222-3333-4444-555555555555',
    title: 'Welcome to the demo workspace',
    url: 'https://www.notion.so/demo-welcome',
    lastEditedTime: '2026-07-01T12:00:00.000Z',
    markdown: '# Welcome\n\nThis page lives in the demo workspace.\n\n- Streamable HTTP\n- Bearer auth\n- Tested',
  },
  {
    id: '66666666-7777-8888-9999-000000000000',
    title: 'Sample meeting notes',
    url: 'https://www.notion.so/demo-notes',
    lastEditedTime: '2026-06-15T09:30:00.000Z',
    markdown: '# Meeting notes\n\nAgenda:\n1. MCP servers\n2. Hono middleware',
  },
];

const demoGateway: NotionGateway = {
  searchPages: async (query, limit = 10) =>
    pages
      .filter((p) => p.title.toLowerCase().includes(query.toLowerCase()))
      .slice(0, limit)
      .map(({ id, title, url, lastEditedTime }) => ({ id, title, url, lastEditedTime })),
  getPageMarkdown: async (pageId) => {
    const page = pages.find((p) => p.id.replaceAll('-', '') === pageId.replaceAll('-', ''));
    if (!page) {
      throw new NotionError('not_found', 'No page with that ID — run search_pages first and copy an ID from the results.');
    }
    return { id: page.id, title: page.title, url: page.url, markdown: page.markdown, truncated: false };
  },
  createPage: async () => {
    throw new Error('preview: write tools must be unreachable');
  },
  appendMarkdown: async () => {
    throw new Error('preview: write tools must be unreachable');
  },
  queryDatabase: async ({ pageSize = 100 }) => ({
    rows: [
      { id: 'row-1', title: 'Build MCP server', url: null, properties: { Status: 'Done', Priority: 'High' } },
      { id: 'row-2', title: 'Add live playground', url: null, properties: { Status: 'In progress', Priority: 'High' } },
      { id: 'row-3', title: 'Write case study', url: null, properties: { Status: 'Todo', Priority: 'Medium' } },
    ].slice(0, pageSize),
    hasMore: false,
    nextCursor: null,
  }),
};

const gateway: NotionGateway = {
  searchPages: async () => {
    throw new Error('preview: the real gateway must never be called');
  },
  getPageMarkdown: async () => {
    throw new Error('preview: the real gateway must never be called');
  },
  createPage: async () => {
    throw new Error('preview: the real gateway must never be called');
  },
  appendMarkdown: async () => {
    throw new Error('preview: the real gateway must never be called');
  },
  queryDatabase: async () => {
    throw new Error('preview: the real gateway must never be called');
  },
};

const app = createApp({ mcpApiKey: 'preview-key', gateway, demoGateway });

serve({ fetch: app.fetch, port: 3123 }, (info) => {
  console.log(`preview listening on http://localhost:${info.port}`);
});
