import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { NotionGateway, QueryDatabaseParams } from '../../notion/gateway.js';
import { textResult, withNotionError } from '../toolResult.js';

const jsonObject = z.record(z.string(), z.unknown());

export function registerQueryDatabaseTool(server: McpServer, gateway: NotionGateway): void {
  server.registerTool(
    'query_database',
    {
      description:
        'Queries a Notion database and returns JSON containing simplified rows, hasMore, and ' +
        'nextCursor. Pass a database ID (not a data source ID), plus optional Notion API filter ' +
        'and sorts JSON; use search_pages for title search across the workspace instead.',
      inputSchema: {
        database_id: z
          .string()
          .min(1)
          .max(100)
          .describe('The Notion database ID to query, with or without UUID hyphens.'),
        filter: jsonObject
          .optional()
          .describe('Optional Notion API filter object, including compound and/or filters.'),
        sorts: z
          .array(jsonObject)
          .max(100)
          .optional()
          .describe('Optional Notion API sorts array, in priority order.'),
        page_size: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Maximum rows to return. Notion defaults to 100; allowed range is 1–100.'),
        start_cursor: z
          .string()
          .min(1)
          .max(1_000)
          .optional()
          .describe('nextCursor from a previous query_database result, for the next page.'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ database_id, filter, sorts, page_size, start_cursor }) =>
      withNotionError(async () => {
        const params: QueryDatabaseParams = {
          databaseId: database_id,
          ...(filter !== undefined && { filter }),
          ...(sorts !== undefined && { sorts }),
          ...(page_size !== undefined && { pageSize: page_size }),
          ...(start_cursor !== undefined && { startCursor: start_cursor }),
        };
        return textResult(await gateway.queryDatabase(params));
      }),
  );
}
