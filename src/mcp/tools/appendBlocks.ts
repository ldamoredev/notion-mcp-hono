import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { NotionGateway } from '../../notion/gateway.js';
import { textResult, withNotionError } from '../toolResult.js';

export function registerAppendBlocksTool(server: McpServer, gateway: NotionGateway): void {
  server.registerTool(
    'append_blocks',
    {
      description:
        'Appends Notion-compatible markdown to the end of an existing page and returns a JSON ' +
        'confirmation with the updated page ID. Pass a page ID from search_pages, get_page, or ' +
        'query_database; use create_page when the destination page does not exist yet.',
      inputSchema: {
        page_id: z
          .string()
          .min(1)
          .max(100)
          .describe('ID of the existing Notion page to update, with or without UUID hyphens.'),
        markdown: z
          .string()
          .min(1)
          .max(500_000)
          .describe('Notion-compatible markdown to append at the end of the page.'),
      },
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async ({ page_id, markdown }) =>
      withNotionError(async () => {
        await gateway.appendMarkdown(page_id, markdown);
        return textResult({ page_id, appended: true });
      }),
  );
}
