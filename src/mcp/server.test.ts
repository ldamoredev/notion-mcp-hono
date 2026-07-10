import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import type { NotionGateway } from '../notion/gateway.js';
import { NotionError } from '../notion/gateway.js';
import { createMcpServer } from './server.js';

function fakeGateway(overrides: Partial<NotionGateway> = {}): NotionGateway {
  return {
    searchPages: vi.fn(async () => []),
    getPageMarkdown: vi.fn(async () => {
      throw new Error('Unexpected getPageMarkdown call');
    }),
    createPage: vi.fn(async () => {
      throw new Error('Unexpected createPage call');
    }),
    appendMarkdown: vi.fn(async () => {
      throw new Error('Unexpected appendMarkdown call');
    }),
    queryDatabase: vi.fn(async () => {
      throw new Error('Unexpected queryDatabase call');
    }),
    ...overrides,
  };
}

async function connectedClient(gateway = fakeGateway()) {
  const server = createMcpServer(gateway);
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

  it('lists exactly the five Notion tools with LLM-facing descriptions and documented inputs', async () => {
    const client = await connectedClient();

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      'search_pages',
      'get_page',
      'create_page',
      'append_blocks',
      'query_database',
    ]);
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      const properties = Object.values(tool.inputSchema.properties ?? {}) as Array<{
        description?: string;
      }>;
      expect(properties.length).toBeGreaterThan(0);
      expect(properties.every((property) => Boolean(property.description))).toBe(true);
    }
  });

  it('returns an in-band error for invalid arguments (so the LLM can self-correct)', async () => {
    const client = await connectedClient();

    const result = await client.callTool({ name: 'search_pages', arguments: { query: 42 } });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('query');
  });

  it('search_pages searches the workspace and returns structured page references', async () => {
    const searchPages = vi.fn(async () => [
      {
        id: 'page-1',
        title: 'Architecture',
        url: 'https://notion.so/page-1',
        lastEditedTime: '2026-07-10T12:00:00.000Z',
      },
    ]);
    const client = await connectedClient(fakeGateway({ searchPages }));

    const result = await client.callTool({
      name: 'search_pages',
      arguments: { query: 'architecture', limit: 5 },
    });

    expect(searchPages).toHaveBeenCalledWith('architecture', 5);
    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([
      {
        type: 'text',
        text: JSON.stringify([
          {
            id: 'page-1',
            title: 'Architecture',
            url: 'https://notion.so/page-1',
            lastEditedTime: '2026-07-10T12:00:00.000Z',
          },
        ]),
      },
    ]);
  });

  it('search_pages omits the optional limit and returns expected Notion errors in-band', async () => {
    const searchPages = vi.fn(async () => {
      throw new NotionError('rate_limited', 'Notion rate-limited the search. Wait and retry.');
    });
    const client = await connectedClient(fakeGateway({ searchPages }));

    const result = await client.callTool({
      name: 'search_pages',
      arguments: { query: 'architecture' },
    });

    expect(searchPages).toHaveBeenCalledWith('architecture');
    expect(result).toMatchObject({
      isError: true,
      content: [
        { type: 'text', text: 'Notion rate-limited the search. Wait and retry.' },
      ],
    });
  });

  it('get_page returns page metadata and clean markdown', async () => {
    const getPageMarkdown = vi.fn(async () => ({
      id: 'page-1',
      title: 'Architecture',
      url: 'https://notion.so/page-1',
      markdown: '# Architecture\n\nThe system design.',
      truncated: false,
    }));
    const client = await connectedClient(fakeGateway({ getPageMarkdown }));

    const result = await client.callTool({
      name: 'get_page',
      arguments: { page_id: 'page-1' },
    });

    expect(getPageMarkdown).toHaveBeenCalledWith('page-1');
    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([
      {
        type: 'text',
        text: JSON.stringify({
          id: 'page-1',
          title: 'Architecture',
          url: 'https://notion.so/page-1',
          markdown: '# Architecture\n\nThe system design.',
          truncated: false,
        }),
      },
    ]);
  });

  it('get_page returns actionable Notion errors in-band', async () => {
    const getPageMarkdown = vi.fn(async () => {
      throw new NotionError(
        'not_found',
        'Page page-missing was not found. Check the ID and share it with the integration.',
      );
    });
    const client = await connectedClient(fakeGateway({ getPageMarkdown }));

    const result = await client.callTool({
      name: 'get_page',
      arguments: { page_id: 'page-missing' },
    });

    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: 'text',
          text: 'Page page-missing was not found. Check the ID and share it with the integration.',
        },
      ],
    });
  });

  it('create_page creates a child page with optional initial markdown', async () => {
    const createPage = vi.fn(async () => ({
      id: 'new-page',
      title: 'Decision record',
      url: 'https://notion.so/new-page',
    }));
    const client = await connectedClient(fakeGateway({ createPage }));

    const result = await client.callTool({
      name: 'create_page',
      arguments: {
        parent_type: 'database',
        parent_id: 'database-1',
        title: 'Decision record',
        markdown: '# Decision\n\nUse Streamable HTTP.',
      },
    });

    expect(createPage).toHaveBeenCalledWith({
      parent: { type: 'database', id: 'database-1' },
      title: 'Decision record',
      markdown: '# Decision\n\nUse Streamable HTTP.',
    });
    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([
      {
        type: 'text',
        text: JSON.stringify({
          id: 'new-page',
          title: 'Decision record',
          url: 'https://notion.so/new-page',
        }),
      },
    ]);
  });

  it('create_page omits absent markdown and returns actionable Notion errors in-band', async () => {
    const createPage = vi.fn(async () => {
      throw new NotionError(
        'validation',
        'Notion rejected the parent. Check parent_type and parent_id.',
      );
    });
    const client = await connectedClient(fakeGateway({ createPage }));

    const result = await client.callTool({
      name: 'create_page',
      arguments: { parent_type: 'page', parent_id: 'parent-1', title: 'Child' },
    });

    expect(createPage).toHaveBeenCalledWith({
      parent: { type: 'page', id: 'parent-1' },
      title: 'Child',
    });
    expect(result).toMatchObject({
      isError: true,
      content: [
        { type: 'text', text: 'Notion rejected the parent. Check parent_type and parent_id.' },
      ],
    });
  });

  it('append_blocks appends markdown and confirms the updated page ID', async () => {
    const appendMarkdown = vi.fn(async () => undefined);
    const client = await connectedClient(fakeGateway({ appendMarkdown }));

    const result = await client.callTool({
      name: 'append_blocks',
      arguments: { page_id: 'page-1', markdown: '## Follow-up\n\nShip it.' },
    });

    expect(appendMarkdown).toHaveBeenCalledWith('page-1', '## Follow-up\n\nShip it.');
    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([
      {
        type: 'text',
        text: JSON.stringify({ page_id: 'page-1', appended: true }),
      },
    ]);
  });

  it('append_blocks returns actionable Notion errors in-band', async () => {
    const appendMarkdown = vi.fn(async () => {
      throw new NotionError(
        'unauthorized',
        'The integration cannot edit page-1. Share the page and retry.',
      );
    });
    const client = await connectedClient(fakeGateway({ appendMarkdown }));

    const result = await client.callTool({
      name: 'append_blocks',
      arguments: { page_id: 'page-1', markdown: 'New content' },
    });

    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: 'text',
          text: 'The integration cannot edit page-1. Share the page and retry.',
        },
      ],
    });
  });

  it('query_database passes filters, sorts, and pagination and returns structured rows', async () => {
    const queryDatabase = vi.fn(async () => ({
      rows: [
        {
          id: 'row-1',
          title: 'Ship phase 5',
          url: 'https://notion.so/row-1',
          properties: { Status: 'Ready', Estimate: 3 },
        },
      ],
      hasMore: true,
      nextCursor: 'cursor-2',
    }));
    const client = await connectedClient(fakeGateway({ queryDatabase }));
    const filter = { property: 'Status', select: { equals: 'Ready' } };
    const sorts = [{ property: 'Updated', direction: 'descending' }];

    const result = await client.callTool({
      name: 'query_database',
      arguments: {
        database_id: 'database-1',
        filter,
        sorts,
        page_size: 25,
        start_cursor: 'cursor-1',
      },
    });

    expect(queryDatabase).toHaveBeenCalledWith({
      databaseId: 'database-1',
      filter,
      sorts,
      pageSize: 25,
      startCursor: 'cursor-1',
    });
    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([
      {
        type: 'text',
        text: JSON.stringify({
          rows: [
            {
              id: 'row-1',
              title: 'Ship phase 5',
              url: 'https://notion.so/row-1',
              properties: { Status: 'Ready', Estimate: 3 },
            },
          ],
          hasMore: true,
          nextCursor: 'cursor-2',
        }),
      },
    ]);
  });

  it('query_database omits absent options and returns actionable Notion errors in-band', async () => {
    const queryDatabase = vi.fn(async () => {
      throw new NotionError(
        'not_found',
        'Database database-missing was not found. Check its ID and connection access.',
      );
    });
    const client = await connectedClient(fakeGateway({ queryDatabase }));

    const result = await client.callTool({
      name: 'query_database',
      arguments: { database_id: 'database-missing' },
    });

    expect(queryDatabase).toHaveBeenCalledWith({ databaseId: 'database-missing' });
    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: 'text',
          text: 'Database database-missing was not found. Check its ID and connection access.',
        },
      ],
    });
  });
});
