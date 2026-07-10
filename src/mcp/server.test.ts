import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createMcpServer } from './server.js';

async function connectedClient() {
  const server = createMcpServer();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe('MCP server', () => {
  it('identifies itself during the initialize handshake', async () => {
    const client = await connectedClient();

    expect(client.getServerVersion()).toMatchObject({ name: 'notion-mcp-hono' });
    expect(client.getServerCapabilities()).toHaveProperty('tools');
  });

  it('lists the ping tool with a description and input schema', async () => {
    const client = await connectedClient();

    const { tools } = await client.listTools();
    const ping = tools.find((t) => t.name === 'ping');

    expect(ping).toBeDefined();
    expect(ping?.description).toBeTruthy();
    expect(ping?.inputSchema.properties).toHaveProperty('message');
  });

  it('calls ping and echoes the message back', async () => {
    const client = await connectedClient();

    const result = await client.callTool({ name: 'ping', arguments: { message: 'hello' } });

    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([{ type: 'text', text: 'pong: hello' }]);
  });

  it('returns an in-band error for invalid arguments (so the LLM can self-correct)', async () => {
    const client = await connectedClient();

    const result = await client.callTool({ name: 'ping', arguments: { message: 42 } });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('message');
  });
});
