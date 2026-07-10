import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createLogger } from './logger.js';
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

const initializeBody = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '0.0.0' },
  },
});

function mcpRequest(headers: Record<string, string> = {}) {
  return app().request('/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: initializeBody,
  });
}

describe('GET /health', () => {
  it('returns 200 with a JSON status body, no auth required', async () => {
    const res = await app().request('/health');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    await expect(res.json()).resolves.toEqual({ status: 'ok' });
  });
});

describe('auth on /mcp', () => {
  it('401s without an Authorization header', async () => {
    const res = await mcpRequest();

    expect(res.status).toBe(401);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain('Authorization: Bearer');
  });

  it('401s with a wrong token', async () => {
    const res = await mcpRequest({ authorization: 'Bearer wrong' });

    expect(res.status).toBe(401);
  });

  it('processes the request with the valid token', async () => {
    const res = await mcpRequest({ authorization: `Bearer ${KEY}` });

    expect(res.status).toBe(200);
  });

  it('401s non-POST methods too (auth runs before method dispatch)', async () => {
    const res = await app().request('/mcp');

    expect(res.status).toBe(401);
  });
});

describe('request logging', () => {
  const capturedApp = () => {
    const lines: string[] = [];
    const logged = createApp({
      mcpApiKey: KEY,
      gateway: unusedGateway,
      logger: createLogger((line) => lines.push(line)),
    });
    return { lines, logged };
  };

  it('logs method, path, status, and duration for /mcp requests', async () => {
    const { lines, logged } = capturedApp();

    await logged.request('/mcp', { method: 'POST', body: '{}' });

    const entries = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    const request = entries.find((e) => e.event === 'http_request');
    expect(request).toMatchObject({ method: 'POST', path: '/mcp', status: 401 });
    expect(request?.durationMs).toBeTypeOf('number');
  });

  it('does not log /health (Railway polls it)', async () => {
    const { lines, logged } = capturedApp();

    await logged.request('/health');

    expect(lines).toHaveLength(0);
  });
});

describe('request body limit', () => {
  it('rejects oversized /mcp bodies with 413 before parsing', async () => {
    const res = await app().request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${KEY}`,
      },
      body: 'x'.repeat(3 * 1024 * 1024),
    });

    expect(res.status).toBe(413);
  });
});

describe('unknown routes', () => {
  it('returns 404 as JSON', async () => {
    const res = await app().request('/nope');

    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
  });
});
