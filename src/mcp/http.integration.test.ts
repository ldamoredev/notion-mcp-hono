import { serve, type ServerType } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { NotionGateway } from '../notion/gateway.js';

// The SDK declares StreamableHTTPClientTransport.sessionId as `string | undefined`,
// which is not assignable to Transport's optional `sessionId?: string` under
// exactOptionalPropertyTypes. Safe at runtime; cast at this one boundary.
const asTransport = (t: StreamableHTTPClientTransport) => t as Transport;

const KEY = 'integration-test-key';

const gateway: NotionGateway = {
  searchPages: async (query) => [
    {
      id: `page-${query}`,
      title: query,
      url: null,
      lastEditedTime: '2026-07-10T12:00:00.000Z',
    },
  ],
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

const authedTransport = (url: URL) =>
  asTransport(
    new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { authorization: `Bearer ${KEY}` } },
    }),
  );

let server: ServerType;
let mcpUrl: URL;

beforeAll(async () => {
  const port = await new Promise<number>((resolve) => {
    server = serve({ fetch: createApp({ mcpApiKey: KEY, gateway }).fetch, port: 0 }, (info) =>
      resolve(info.port),
    );
  });
  mcpUrl = new URL(`http://127.0.0.1:${port}/mcp`);
});

afterAll(() => {
  server.close();
});

describe('Streamable HTTP endpoint', () => {
  it('accepts a real MCP client: initialize, list tools, call a Notion tool', async () => {
    const client = new Client({ name: 'integration-client', version: '0.0.0' });
    await client.connect(authedTransport(mcpUrl));

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      'search_pages',
      'get_page',
      'create_page',
      'append_blocks',
      'query_database',
    ]);

    const result = await client.callTool({
      name: 'search_pages',
      arguments: { query: 'round-trip' },
    });
    expect(result.content).toEqual([
      {
        type: 'text',
        text: JSON.stringify([
          {
            id: 'page-round-trip',
            title: 'round-trip',
            url: null,
            lastEditedTime: '2026-07-10T12:00:00.000Z',
          },
        ]),
      },
    ]);

    await client.close();
  });

  it('handles two independent clients (stateless: no shared session)', async () => {
    const connect = async (name: string) => {
      const client = new Client({ name, version: '0.0.0' });
      await client.connect(authedTransport(mcpUrl));
      return client;
    };
    const [a, b] = await Promise.all([connect('client-a'), connect('client-b')]);

    const [ra, rb] = await Promise.all([
      a.callTool({ name: 'search_pages', arguments: { query: 'a' } }),
      b.callTool({ name: 'search_pages', arguments: { query: 'b' } }),
    ]);

    expect(JSON.stringify(ra.content)).toContain('page-a');
    expect(JSON.stringify(rb.content)).toContain('page-b');

    await Promise.all([a.close(), b.close()]);
  });

  it('rejects an unauthenticated MCP client', async () => {
    const client = new Client({ name: 'anon-client', version: '0.0.0' });

    await expect(
      client.connect(asTransport(new StreamableHTTPClientTransport(mcpUrl))),
    ).rejects.toThrow(/unauthorized/i);
  });

  it('rejects GET and DELETE with 405 when authenticated (no sessions to stream or terminate)', async () => {
    const headers = { authorization: `Bearer ${KEY}`, accept: 'text/event-stream' };

    const get = await fetch(mcpUrl, { headers });
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
    await get.body?.cancel();

    const del = await fetch(mcpUrl, { method: 'DELETE', headers });
    expect(del.status).toBe(405);
    await del.body?.cancel();
  });
});
