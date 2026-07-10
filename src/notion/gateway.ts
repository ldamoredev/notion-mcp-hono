/**
 * Domain-level contract the MCP tools depend on. Nothing in here imports
 * @notionhq/client — the SDK stays behind createNotionGateway (client.ts),
 * so the Notion integration is replaceable without touching MCP code.
 */

export interface PageRef {
  id: string;
  title: string;
  url: string | null;
}

export interface SearchResultItem extends PageRef {
  lastEditedTime: string;
}

export interface PageMarkdown extends PageRef {
  markdown: string;
  /** True when Notion truncated the markdown because the page is very large. */
  truncated: boolean;
}

export interface CreatePageParams {
  parent: { type: 'page' | 'database'; id: string };
  title: string;
  markdown?: string;
}

export interface QueryDatabaseParams {
  databaseId: string;
  /** Notion filter object, passed through verbatim. */
  filter?: unknown;
  /** Notion sorts array, passed through verbatim. */
  sorts?: unknown;
  pageSize?: number;
  startCursor?: string;
}

export interface DatabaseRow {
  id: string;
  title: string;
  url: string | null;
  properties: Record<string, unknown>;
}

export interface QueryDatabaseResult {
  rows: DatabaseRow[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface NotionGateway {
  searchPages(query: string, limit?: number): Promise<SearchResultItem[]>;
  getPageMarkdown(pageId: string): Promise<PageMarkdown>;
  createPage(params: CreatePageParams): Promise<PageRef>;
  appendMarkdown(pageId: string, markdown: string): Promise<void>;
  queryDatabase(params: QueryDatabaseParams): Promise<QueryDatabaseResult>;
}

export type NotionErrorCode =
  | 'not_found'
  | 'unauthorized'
  | 'rate_limited'
  | 'validation'
  | 'api_error';

/**
 * Typed error with a message written for the MCP caller (an LLM): it states
 * what went wrong and what to do about it, never the raw Notion API error.
 */
export class NotionError extends Error {
  constructor(
    readonly code: NotionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'NotionError';
  }
}
