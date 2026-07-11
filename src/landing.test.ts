import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import type { NotionGateway } from './notion/gateway.js';

const KEY = 'test-api-key';
const unusedGateway: NotionGateway = {
  searchPages: async () => [],
  getPageMarkdown: async () => {
    throw new Error('Unexpected getPageMarkdown call');
  },
  createPage: async () => {
    throw new Error('Unexpected createPage call');
  },
  appendMarkdown: async () => {
    throw new Error('Unexpected appendMarkdown call');
  },
  queryDatabase: async () => {
    throw new Error('Unexpected queryDatabase call');
  },
};
const app = () => createApp({ mcpApiKey: KEY, gateway: unusedGateway });

describe('GET / (landing page)', () => {
  it('serves the landing page as HTML, no auth required', async () => {
    const res = await app().request('/');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('notion-mcp-hono');
    expect(html).toContain('demo to production');
  });

  it('lists the five tools', async () => {
    const html = await (await app().request('/')).text();

    for (const tool of ['search_pages', 'get_page', 'create_page', 'append_blocks', 'query_database']) {
      expect(html).toContain(tool);
    }
  });
});

describe('playground section', () => {
  it('ships the playground container and its script', async () => {
    const html = await (await app().request('/')).text();

    expect(html).toContain('id="playground"');
    expect(html).toContain('/static/playground.js');
  });

  it('serves the playground script as JavaScript', async () => {
    const res = await app().request('/static/playground.js');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
  });
});

describe('GET /static/* (assets)', () => {
  it('serves the stylesheet with a CSS content type', async () => {
    const res = await app().request('/static/styles.css');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/css');
  });

  it('404s for assets that do not exist', async () => {
    const res = await app().request('/static/nope.js');

    expect(res.status).toBe(404);
  });
});

describe('polish: metadata and caching', () => {
  it('ships favicon and Open Graph tags', async () => {
    const html = await (await app().request('/')).text();

    expect(html).toContain('rel="icon"');
    expect(html).toContain('property="og:title"');
    expect(html).toContain('property="og:image"');
    expect(html).toContain('name="twitter:card"');
  });

  it('serves the favicon as SVG', async () => {
    const res = await app().request('/static/favicon.svg');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('svg');
  });

  it('caches static assets but not the HTML shell', async () => {
    const asset = await app().request('/static/styles.css');
    const page = await app().request('/');

    expect(asset.headers.get('cache-control')).toContain('max-age');
    expect(page.headers.get('cache-control')).toContain('no-cache');
  });
});

describe('regression: landing routes do not touch the MCP surface', () => {
  it('POST /mcp still requires the bearer token', async () => {
    const res = await app().request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(res.status).toBe(401);
  });

  it('GET /health still responds without auth', async () => {
    const res = await app().request('/health');

    expect(res.status).toBe(200);
  });
});
