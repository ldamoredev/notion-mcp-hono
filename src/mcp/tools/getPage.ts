import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { NotionGateway } from '../../notion/gateway.js';
import { textResult, type ToolRunner } from '../toolResult.js';

/** Shared with the demo routes (/demo/run/get_page) so both surfaces validate identically. */
export const getPageInput = {
  page_id: z
    .string()
    .min(1)
    .max(100)
    .describe('The Notion page ID to retrieve, with or without UUID hyphens.'),
};

export function registerGetPageTool(server: McpServer, gateway: NotionGateway, run: ToolRunner): void {
  server.registerTool(
    'get_page',
    {
      description:
        'Retrieves one Notion page and returns a JSON object containing its ID, title, URL, ' +
        'clean markdown content, and whether that content was truncated. Pass a page ID found ' +
        'with search_pages or query_database; use query_database to retrieve multiple database rows.',
      inputSchema: getPageInput,
      annotations: { readOnlyHint: true },
    },
    async ({ page_id }) =>
      run('get_page', async () => textResult(await gateway.getPageMarkdown(page_id))),
  );
}
