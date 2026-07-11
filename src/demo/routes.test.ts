import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { AppConfig } from '../app.js';
import { NotionError } from '../notion/gateway.js';
import type { NotionGateway } from '../notion/gateway.js';

const KEY = 'test-api-key';

/** The real-workspace gateway: any call from a demo route is a severe bug. */
function forbiddenGateway(): NotionGateway {
  const fail = (method: string) => async (): Promise<never> => {
    throw new Error(`Demo route reached the real-workspace gateway: ${method}`);
  };
  return {
    searchPages: fail('searchPages'),
    getPageMarkdown: fail('getPageMarkdown'),
    createPage: fail('createPage'),
    appendMarkdown: fail('appendMarkdown'),
    queryDatabase: fail('queryDatabase'),
  };
}

/** Happy-path demo gateway that records write calls so tests can assert zero. */
function fakeDemoGateway() {
  const writeCalls: string[] = [];
  const gateway: NotionGateway = {
    searchPages: async (query, limit) => [
      { id: 'p1', title: `Result for ${query} (limit ${limit ?? 'default'})`, url: null, lastEditedTime: '2026-01-01T00:00:00.000Z' },
    ],
    getPageMarkdown: async (pageId) => ({
      id: pageId,
      title: 'Demo page',
      url: null,
      markdown: '# Hello',
      truncated: false,
    }),
    createPage: async () => {
      writeCalls.push('createPage');
      return { id: 'x', title: 'x', url: null };
    },
    appendMarkdown: async () => {
      writeCalls.push('appendMarkdown');
    },
    queryDatabase: async () => ({
      rows: [{ id: 'r1', title: 'Row', url: null, properties: { Status: 'Done' } }],
      hasMore: false,
      nextCursor: null,
    }),
  };
  return { gateway, writeCalls };
}

function demoApp(overrides: Partial<AppConfig> = {}) {
  const { gateway, writeCalls } = fakeDemoGateway();
  const app = createApp({
    mcpApiKey: KEY,
    gateway: forbiddenGateway(),
    demoGateway: gateway,
    ...overrides,
  });
  return { app, writeCalls };
}

function runTool(app: ReturnType<typeof createApp>, tool: string, body: unknown, ip = '203.0.113.7') {
  return app.request(`/demo/run/${tool}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

describe('POST /demo/run/:tool — happy paths (demo gateway only)', () => {
  it('runs search_pages and returns the result envelope', async () => {
    const { app } = demoApp();

    const res = await runTool(app, 'search_pages', { query: 'roadmap' });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; tool: string; result: unknown[] };
    expect(body.ok).toBe(true);
    expect(body.tool).toBe('search_pages');
    expect(body.result).toHaveLength(1);
  });

  it('runs get_page', async () => {
    const { app } = demoApp();

    const res = await runTool(app, 'get_page', { page_id: 'abc123' });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { markdown: string } };
    expect(body.result.markdown).toBe('# Hello');
  });

  it('runs query_database', async () => {
    const { app } = demoApp();

    const res = await runTool(app, 'query_database', { database_id: 'db1', page_size: 5 });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { rows: unknown[]; hasMore: boolean } };
    expect(body.result.rows).toHaveLength(1);
    expect(body.result.hasMore).toBe(false);
  });
});

describe('read-only allowlist — write tools are unreachable', () => {
  it.each(['create_page', 'append_blocks'])('404s for %s and never calls the gateway', async (tool) => {
    const { app, writeCalls } = demoApp();

    const res = await runTool(app, tool, {
      parent_type: 'page',
      parent_id: 'p',
      title: 't',
      page_id: 'p',
      markdown: 'm',
    });

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('unknown_tool');
    expect(body.message).toContain('read-only');
    expect(writeCalls).toHaveLength(0);
  });

  it.each(['CREATE_PAGE', 'create_page%20', '__proto__', 'constructor', 'ping'])(
    '404s for non-allowlisted name %s',
    async (tool) => {
      const { app, writeCalls } = demoApp();

      const res = await runTool(app, tool, { query: 'x' });

      expect(res.status).toBe(404);
      expect(writeCalls).toHaveLength(0);
    },
  );
});

describe('input validation', () => {
  it('400s with a field-naming message when arguments are invalid', async () => {
    const { app } = demoApp();

    const res = await runTool(app, 'search_pages', { limit: 5 });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('invalid_input');
    expect(body.message).toContain('query');
  });

  it('400s when the body is not JSON', async () => {
    const { app } = demoApp();

    const res = await app.request('/demo/run/search_pages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
      body: 'not json',
    });

    expect(res.status).toBe(400);
  });
});

describe('error translation', () => {
  it('502s with the curated message on NotionError', async () => {
    const { app } = demoApp({
      demoGateway: {
        ...fakeDemoGateway().gateway,
        searchPages: async () => {
          throw new NotionError('unauthorized', 'Share the page with the integration first.');
        },
      },
    });

    const res = await runTool(app, 'search_pages', { query: 'x' });

    expect(res.status).toBe(502);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe('Share the page with the integration first.');
  });

  it('500s with a generic message on unexpected errors — internals never leak', async () => {
    const { app } = demoApp({
      demoGateway: {
        ...fakeDemoGateway().gateway,
        searchPages: async () => {
          throw new Error('secret internal detail');
        },
      },
    });

    const res = await runTool(app, 'search_pages', { query: 'x' });

    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('secret internal detail');
  });
});

describe('rate limiting per IP', () => {
  it('429s over the limit with a friendly message and Retry-After', async () => {
    const { app } = demoApp({ demoRateLimit: { limit: 2, windowMs: 60_000 } });

    await runTool(app, 'search_pages', { query: 'x' });
    await runTool(app, 'search_pages', { query: 'x' });
    const res = await runTool(app, 'search_pages', { query: 'x' });

    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toMatch(/^\d+$/);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('rate_limited');
    expect(body.message).toContain('per minute');
  });

  it('does not throttle a different IP', async () => {
    const { app } = demoApp({ demoRateLimit: { limit: 1, windowMs: 60_000 } });

    await runTool(app, 'search_pages', { query: 'x' }, '203.0.113.7');
    const res = await runTool(app, 'search_pages', { query: 'x' }, '198.51.100.9');

    expect(res.status).toBe(200);
  });
});

describe('demo disabled (no DEMO_NOTION_TOKEN)', () => {
  it('503s with a clear message instead of falling back to the real gateway', async () => {
    const app = createApp({ mcpApiKey: KEY, gateway: forbiddenGateway() });

    const res = await runTool(app, 'search_pages', { query: 'x' });

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('demo_disabled');
  });
});

describe('regression: the MCP surface is untouched by demo config', () => {
  it('/mcp still 401s without a bearer token when the demo is enabled', async () => {
    const { app } = demoApp();

    const res = await app.request('/mcp', { method: 'POST', body: '{}' });

    expect(res.status).toBe(401);
  });
});
