import { serve, type ServerType } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';

// The SDK declares StreamableHTTPClientTransport.sessionId as `string | undefined`,
// which is not assignable to Transport's optional `sessionId?: string` under
// exactOptionalPropertyTypes. Safe at runtime; cast at this one boundary.
const asTransport = (t: StreamableHTTPClientTransport) => t as Transport;

let server: ServerType;
let mcpUrl: URL;

beforeAll(async () => {
  const port = await new Promise<number>((resolve) => {
    server = serve({ fetch: createApp().fetch, port: 0 }, (info) => resolve(info.port));
  });
  mcpUrl = new URL(`http://127.0.0.1:${port}/mcp`);
});

afterAll(() => {
  server.close();
});

describe('Streamable HTTP endpoint', () => {
  it('accepts a real MCP client: initialize, list tools, call ping', async () => {
    const client = new Client({ name: 'integration-client', version: '0.0.0' });
    await client.connect(asTransport(new StreamableHTTPClientTransport(mcpUrl)));

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('ping');

    const result = await client.callTool({ name: 'ping', arguments: { message: 'round-trip' } });
    expect(result.content).toEqual([{ type: 'text', text: 'pong: round-trip' }]);

    await client.close();
  });

  it('handles two independent clients (stateless: no shared session)', async () => {
    const connect = async (name: string) => {
      const client = new Client({ name, version: '0.0.0' });
      await client.connect(asTransport(new StreamableHTTPClientTransport(mcpUrl)));
      return client;
    };
    const [a, b] = await Promise.all([connect('client-a'), connect('client-b')]);

    const [ra, rb] = await Promise.all([
      a.callTool({ name: 'ping', arguments: { message: 'a' } }),
      b.callTool({ name: 'ping', arguments: { message: 'b' } }),
    ]);

    expect(ra.content).toEqual([{ type: 'text', text: 'pong: a' }]);
    expect(rb.content).toEqual([{ type: 'text', text: 'pong: b' }]);

    await Promise.all([a.close(), b.close()]);
  });

  it('rejects GET and DELETE with 405 (no sessions to stream or terminate)', async () => {
    const get = await fetch(mcpUrl, { headers: { accept: 'text/event-stream' } });
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
    await get.body?.cancel();

    const del = await fetch(mcpUrl, { method: 'DELETE' });
    expect(del.status).toBe(405);
    await del.body?.cancel();
  });
});
