import type { Client } from '@notionhq/client';
import { APIErrorCode, APIResponseError } from '@notionhq/client';
import { describe, expect, it, vi } from 'vitest';
import { createNotionGateway } from './client.js';
import { NotionError } from './gateway.js';

const PAGE_ID = '11111111-2222-3333-4444-555555555555';
const DB_ID = '99999999-8888-7777-6666-555555555555';
const DS_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function apiError(code: APIErrorCode, status: number) {
  return new APIResponseError({
    code,
    status,
    message: `notion says: ${code}`,
    headers: {},
    rawBodyText: '{}',
    additional_data: undefined,
    request_id: 'req_123',
  });
}

function notionPage(overrides: Record<string, unknown> = {}) {
  return {
    object: 'page',
    id: PAGE_ID,
    url: `https://www.notion.so/My-page-${PAGE_ID.replaceAll('-', '')}`,
    last_edited_time: '2026-07-01T00:00:00.000Z',
    properties: {
      title: { id: 'title', type: 'title', title: [{ plain_text: 'My page' }] },
    },
    ...overrides,
  };
}

function fakeNotion() {
  return {
    search: vi.fn(),
    pages: {
      create: vi.fn(),
      retrieve: vi.fn(),
      retrieveMarkdown: vi.fn(),
      updateMarkdown: vi.fn(),
    },
    databases: {
      retrieve: vi.fn(),
    },
    dataSources: {
      query: vi.fn(),
    },
  };
}

const asClient = (fake: ReturnType<typeof fakeNotion>) => fake as unknown as Client;

describe('searchPages', () => {
  it('searches pages only and maps results to id/title/url', async () => {
    const fake = fakeNotion();
    fake.search.mockResolvedValue({ results: [notionPage()], has_more: false, next_cursor: null });
    const gateway = createNotionGateway(asClient(fake));

    const results = await gateway.searchPages('my page', 5);

    expect(fake.search).toHaveBeenCalledWith({
      query: 'my page',
      filter: { property: 'object', value: 'page' },
      page_size: 5,
    });
    expect(results).toEqual([
      {
        id: PAGE_ID,
        title: 'My page',
        url: `https://www.notion.so/My-page-${PAGE_ID.replaceAll('-', '')}`,
        lastEditedTime: '2026-07-01T00:00:00.000Z',
      },
    ]);
  });

  it('skips partial results that have no properties', async () => {
    const fake = fakeNotion();
    fake.search.mockResolvedValue({
      results: [{ object: 'page', id: 'partial' }, notionPage()],
      has_more: false,
      next_cursor: null,
    });
    const gateway = createNotionGateway(asClient(fake));

    const results = await gateway.searchPages('x');

    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe(PAGE_ID);
  });
});

describe('getPageMarkdown', () => {
  it('returns title, url, and the markdown Notion produced', async () => {
    const fake = fakeNotion();
    fake.pages.retrieve.mockResolvedValue(notionPage());
    fake.pages.retrieveMarkdown.mockResolvedValue({
      object: 'page_markdown',
      id: PAGE_ID,
      markdown: '# Hello\n\nWorld',
      truncated: false,
      unknown_block_ids: [],
    });
    const gateway = createNotionGateway(asClient(fake));

    const page = await gateway.getPageMarkdown(PAGE_ID);

    expect(fake.pages.retrieveMarkdown).toHaveBeenCalledWith({ page_id: PAGE_ID });
    expect(page).toEqual({
      id: PAGE_ID,
      title: 'My page',
      url: expect.stringContaining('notion.so'),
      markdown: '# Hello\n\nWorld',
      truncated: false,
    });
  });

  it('maps object_not_found to a NotionError telling the caller to share the page', async () => {
    const fake = fakeNotion();
    fake.pages.retrieve.mockRejectedValue(apiError(APIErrorCode.ObjectNotFound, 404));
    fake.pages.retrieveMarkdown.mockRejectedValue(apiError(APIErrorCode.ObjectNotFound, 404));
    const gateway = createNotionGateway(asClient(fake));

    const failure = gateway.getPageMarkdown(PAGE_ID);

    await expect(failure).rejects.toBeInstanceOf(NotionError);
    await expect(failure).rejects.toMatchObject({ code: 'not_found' });
    await expect(failure).rejects.toThrow(/shared with the integration/i);
  });
});

describe('createPage', () => {
  it('creates under a page parent with the title property', async () => {
    const fake = fakeNotion();
    fake.pages.create.mockResolvedValue(notionPage());
    const gateway = createNotionGateway(asClient(fake));

    const ref = await gateway.createPage({
      parent: { type: 'page', id: PAGE_ID },
      title: 'My page',
    });

    expect(fake.pages.create).toHaveBeenCalledWith({
      parent: { page_id: PAGE_ID },
      properties: { title: { title: [{ type: 'text', text: { content: 'My page' } }] } },
    });
    expect(fake.pages.updateMarkdown).not.toHaveBeenCalled();
    expect(ref).toMatchObject({ id: PAGE_ID, title: 'My page' });
  });

  it('resolves a database parent to its data source', async () => {
    const fake = fakeNotion();
    fake.databases.retrieve.mockResolvedValue({ id: DB_ID, data_sources: [{ id: DS_ID, name: 'Tasks' }] });
    fake.pages.create.mockResolvedValue(notionPage());
    const gateway = createNotionGateway(asClient(fake));

    await gateway.createPage({ parent: { type: 'database', id: DB_ID }, title: 'My page' });

    expect(fake.databases.retrieve).toHaveBeenCalledWith({ database_id: DB_ID });
    expect(fake.pages.create).toHaveBeenCalledWith(
      expect.objectContaining({ parent: { data_source_id: DS_ID } }),
    );
  });

  it('appends markdown body after creating, at the end of the page', async () => {
    const fake = fakeNotion();
    fake.pages.create.mockResolvedValue(notionPage());
    fake.pages.updateMarkdown.mockResolvedValue({ markdown: '', truncated: false });
    const gateway = createNotionGateway(asClient(fake));

    await gateway.createPage({
      parent: { type: 'page', id: PAGE_ID },
      title: 'My page',
      markdown: '## Section\n\nBody text',
    });

    expect(fake.pages.updateMarkdown).toHaveBeenCalledWith({
      page_id: PAGE_ID,
      type: 'insert_content',
      insert_content: { content: '## Section\n\nBody text', position: { type: 'end' } },
    });
  });

  it('fails with a validation NotionError when the database has no data sources', async () => {
    const fake = fakeNotion();
    fake.databases.retrieve.mockResolvedValue({ id: DB_ID, data_sources: [] });
    const gateway = createNotionGateway(asClient(fake));

    const failure = gateway.createPage({ parent: { type: 'database', id: DB_ID }, title: 'x' });

    await expect(failure).rejects.toMatchObject({ code: 'validation' });
  });
});

describe('appendMarkdown', () => {
  it('inserts markdown at the end of the page', async () => {
    const fake = fakeNotion();
    fake.pages.updateMarkdown.mockResolvedValue({ markdown: '', truncated: false });
    const gateway = createNotionGateway(asClient(fake));

    await gateway.appendMarkdown(PAGE_ID, '- new item');

    expect(fake.pages.updateMarkdown).toHaveBeenCalledWith({
      page_id: PAGE_ID,
      type: 'insert_content',
      insert_content: { content: '- new item', position: { type: 'end' } },
    });
  });

  it('maps rate limiting to a NotionError with code rate_limited', async () => {
    const fake = fakeNotion();
    fake.pages.updateMarkdown.mockRejectedValue(apiError(APIErrorCode.RateLimited, 429));
    const gateway = createNotionGateway(asClient(fake));

    await expect(gateway.appendMarkdown(PAGE_ID, 'x')).rejects.toMatchObject({
      code: 'rate_limited',
    });
  });
});

describe('queryDatabase', () => {
  it('resolves the data source, forwards filter/sorts, and simplifies row properties', async () => {
    const fake = fakeNotion();
    fake.databases.retrieve.mockResolvedValue({ id: DB_ID, data_sources: [{ id: DS_ID, name: 'Tasks' }] });
    fake.dataSources.query.mockResolvedValue({
      results: [
        notionPage({
          properties: {
            Name: { id: 'title', type: 'title', title: [{ plain_text: 'Task A' }] },
            Status: { id: 's', type: 'status', status: { name: 'Done' } },
          },
        }),
      ],
      has_more: true,
      next_cursor: 'cursor-1',
    });
    const gateway = createNotionGateway(asClient(fake));

    const filter = { property: 'Status', status: { equals: 'Done' } };
    const sorts = [{ property: 'Name', direction: 'ascending' }];
    const result = await gateway.queryDatabase({ databaseId: DB_ID, filter, sorts, pageSize: 10 });

    expect(fake.dataSources.query).toHaveBeenCalledWith({
      data_source_id: DS_ID,
      filter,
      sorts,
      page_size: 10,
    });
    expect(result).toEqual({
      rows: [
        {
          id: PAGE_ID,
          title: 'Task A',
          url: expect.stringContaining('notion.so'),
          properties: { Name: 'Task A', Status: 'Done' },
        },
      ],
      hasMore: true,
      nextCursor: 'cursor-1',
    });
  });

  it('passes the pagination cursor through', async () => {
    const fake = fakeNotion();
    fake.databases.retrieve.mockResolvedValue({ id: DB_ID, data_sources: [{ id: DS_ID, name: 'Tasks' }] });
    fake.dataSources.query.mockResolvedValue({ results: [], has_more: false, next_cursor: null });
    const gateway = createNotionGateway(asClient(fake));

    await gateway.queryDatabase({ databaseId: DB_ID, startCursor: 'cursor-1' });

    expect(fake.dataSources.query).toHaveBeenCalledWith(
      expect.objectContaining({ start_cursor: 'cursor-1' }),
    );
  });

  it('maps unauthorized to a NotionError about the integration token', async () => {
    const fake = fakeNotion();
    fake.databases.retrieve.mockRejectedValue(apiError(APIErrorCode.Unauthorized, 401));
    const gateway = createNotionGateway(asClient(fake));

    const failure = gateway.queryDatabase({ databaseId: DB_ID });

    await expect(failure).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(failure).rejects.toThrow(/NOTION_TOKEN/);
  });
});
