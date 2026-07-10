import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { NotionGateway } from '../../notion/gateway.js';
import { textResult, type ToolRunner } from '../toolResult.js';

export function registerCreatePageTool(server: McpServer, gateway: NotionGateway, run: ToolRunner): void {
  server.registerTool(
    'create_page',
    {
      description:
        'Creates a Notion page under an existing page or database and returns its ID, title, and URL ' +
        'as JSON. Use parent_type "page" for a child page or "database" for a database row; ' +
        'include markdown to set initial page content, or use append_blocks later to add content.',
      inputSchema: {
        parent_type: z
          .enum(['page', 'database'])
          .describe('Whether parent_id identifies a Notion page or a Notion database.'),
        parent_id: z
          .string()
          .min(1)
          .max(100)
          .describe('ID of the existing parent page or database, with or without UUID hyphens.'),
        title: z
          .string()
          .min(1)
          .max(2_000)
          .describe('Title for the new page or database row.'),
        markdown: z
          .string()
          .max(500_000)
          .optional()
          .describe('Optional initial page content in Notion-compatible markdown.'),
      },
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async ({ parent_type, parent_id, title, markdown }) =>
      run('create_page', async () => {
        const page = await gateway.createPage({
          parent: { type: parent_type, id: parent_id },
          title,
          ...(markdown !== undefined && { markdown }),
        });
        return textResult(page);
      }),
  );
}
