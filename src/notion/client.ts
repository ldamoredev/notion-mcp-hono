import type { Client } from '@notionhq/client';
import { isNotionClientError, APIErrorCode } from '@notionhq/client';
import type {
  CreatePageParams,
  NotionGateway,
  PageMarkdown,
  PageRef,
  QueryDatabaseParams,
  QueryDatabaseResult,
  SearchResultItem,
} from './gateway.js';
import { NotionError } from './gateway.js';
import { pageTitle, simplifyProperties } from './properties.js';

/** A search/query result narrowed to the fields we actually read. */
interface PageLike {
  object?: string;
  id: string;
  url?: string | null;
  last_edited_time?: string;
  properties?: Record<string, unknown>;
}

export function createNotionGateway(notion: Client): NotionGateway {
  return {
    async searchPages(query, limit = 10): Promise<SearchResultItem[]> {
      const response = await run('searching pages', () =>
        notion.search({
          query,
          filter: { property: 'object', value: 'page' },
          page_size: limit,
        }),
      );
      return (response.results as PageLike[])
        .filter((r) => r.object === 'page' && r.properties !== undefined)
        .map((page) => ({
          ...toPageRef(page),
          lastEditedTime: page.last_edited_time ?? '',
        }));
    },

    async getPageMarkdown(pageId): Promise<PageMarkdown> {
      const [page, markdown] = await run(`retrieving page ${pageId}`, () =>
        Promise.all([
          notion.pages.retrieve({ page_id: pageId }),
          notion.pages.retrieveMarkdown({ page_id: pageId }),
        ]),
      );
      return {
        ...toPageRef(page as PageLike),
        markdown: markdown.markdown,
        truncated: markdown.truncated,
      };
    },

    async createPage({ parent, title, markdown }: CreatePageParams): Promise<PageRef> {
      const parentRef =
        parent.type === 'page'
          ? { page_id: parent.id }
          : { data_source_id: await resolveDataSourceId(notion, parent.id) };

      const page = await run(`creating page "${title}"`, () =>
        notion.pages.create({
          parent: parentRef,
          properties: { title: { title: [{ type: 'text', text: { content: title } }] } },
        }),
      );

      if (markdown !== undefined) {
        await insertMarkdownAtEnd(notion, page.id, markdown);
      }
      return toPageRef(page as PageLike);
    },

    async appendMarkdown(pageId, markdown): Promise<void> {
      await insertMarkdownAtEnd(notion, pageId, markdown);
    },

    async queryDatabase(params: QueryDatabaseParams): Promise<QueryDatabaseResult> {
      const dataSourceId = await resolveDataSourceId(notion, params.databaseId);
      const response = await run(`querying database ${params.databaseId}`, () =>
        notion.dataSources.query({
          data_source_id: dataSourceId,
          ...(params.filter !== undefined && { filter: params.filter as never }),
          ...(params.sorts !== undefined && { sorts: params.sorts as never }),
          ...(params.pageSize !== undefined && { page_size: params.pageSize }),
          ...(params.startCursor !== undefined && { start_cursor: params.startCursor }),
        }),
      );

      const rows = (response.results as PageLike[])
        .filter((r) => r.properties !== undefined)
        .map((page) => ({
          ...toPageRef(page),
          properties: simplifyProperties(page.properties ?? {}),
        }));

      return { rows, hasMore: response.has_more, nextCursor: response.next_cursor };
    },
  };
}

function toPageRef(page: PageLike): PageRef {
  return {
    id: page.id,
    title: pageTitle(page.properties ?? {}),
    url: page.url ?? null,
  };
}

async function resolveDataSourceId(notion: Client, databaseId: string): Promise<string> {
  const database = await run(`retrieving database ${databaseId}`, () =>
    notion.databases.retrieve({ database_id: databaseId }),
  );
  const dataSources = (database as { data_sources?: Array<{ id: string }> }).data_sources ?? [];
  const first = dataSources[0];
  if (!first) {
    throw new NotionError(
      'validation',
      `Database ${databaseId} has no data sources to write to or query. ` +
        'Verify the ID belongs to a database (not a page) and that the database is set up.',
    );
  }
  return first.id;
}

async function insertMarkdownAtEnd(notion: Client, pageId: string, markdown: string): Promise<void> {
  await run(`appending content to page ${pageId}`, () =>
    notion.pages.updateMarkdown({
      page_id: pageId,
      type: 'insert_content',
      insert_content: { content: markdown, position: { type: 'end' } },
    }),
  );
}

/** Runs a Notion call, translating SDK errors into NotionError with an actionable message. */
async function run<T>(context: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw translate(error, context);
  }
}

function translate(error: unknown, context: string): Error {
  if (!isNotionClientError(error)) {
    return error instanceof Error ? error : new Error(String(error));
  }
  switch (error.code) {
    case APIErrorCode.ObjectNotFound:
      return new NotionError(
        'not_found',
        `Notion returned "not found" while ${context}. Either the ID is wrong or the item ` +
          'has not been shared with the integration (open it in Notion → ⋯ → Connections).',
      );
    case APIErrorCode.Unauthorized:
    case APIErrorCode.RestrictedResource:
      return new NotionError(
        'unauthorized',
        `Notion rejected the credentials while ${context}. Check that NOTION_TOKEN is a valid ` +
          'internal integration token and that the integration has access to this content.',
      );
    case APIErrorCode.RateLimited:
      return new NotionError(
        'rate_limited',
        `Notion rate-limited the request while ${context}. Wait a few seconds and retry.`,
      );
    case APIErrorCode.ValidationError:
    case APIErrorCode.InvalidRequest:
      return new NotionError(
        'validation',
        `Notion rejected the request while ${context}: ${error.message}. ` +
          'Check the IDs and the shape of any filter/sorts you passed.',
      );
    default:
      return new NotionError(
        'api_error',
        `The Notion API failed while ${context} (${error.code}). Retry, and if it persists ` +
          'check https://status.notion.so.',
      );
  }
}
