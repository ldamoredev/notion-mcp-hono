import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import type { NotionGateway } from '../notion/gateway.js';
import { createMcpServer } from './server.js';

const explodingGateway: NotionGateway = {
  searchPages: async () => {
    throw new Error('TypeError: cannot read properties of undefined (internal stack detail)');
  },
  getPageMarkdown: async () => {
    throw new Error('unexpected');
  },
  createPage: async () => {
    throw new Error('unexpected');
  },
  appendMarkdown: async () => {
    throw new Error('unexpected');
  },
  queryDatabase: async () => {
    throw new Error('unexpected');
  },
};

describe('unexpected gateway failures', () => {
  it('reach the client as a generic in-band error, without internals', async () => {
    const server = createMcpServer(explodingGateway);
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: 'search_pages', arguments: { query: 'x' } });

    expect(result.isError).toBe(true);
    const text = JSON.stringify(result.content);
    expect(text).not.toContain('internal stack detail');
    expect(text).toMatch(/unexpected server error/i);
  });
});
