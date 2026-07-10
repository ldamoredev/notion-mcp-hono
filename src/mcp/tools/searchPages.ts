import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { NotionGateway } from '../../notion/gateway.js';
import { textResult, withNotionError } from '../toolResult.js';

export function registerSearchPagesTool(server: McpServer, gateway: NotionGateway): void {
  server.registerTool(
    'search_pages',
    {
      description:
        'Searches pages the Notion integration can access and returns a JSON array of page IDs, ' +
        'titles, URLs, and last-edited timestamps. Use this to discover a page ID before get_page ' +
        'or append_blocks; use query_database instead when you need database filters or sorts.',
      inputSchema: {
        query: z
          .string()
          .min(1)
          .max(2_000)
          .describe('Text to match against page titles in the connected Notion workspace.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Maximum number of pages to return. Defaults to 10; allowed range is 1–100.'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, limit }) =>
      withNotionError(async () => {
        const pages =
          limit === undefined
            ? await gateway.searchPages(query)
            : await gateway.searchPages(query, limit);
        return textResult(pages);
      }),
  );
}
