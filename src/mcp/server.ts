import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from '../logger.js';
import { silentLogger } from '../logger.js';
import type { NotionGateway } from '../notion/gateway.js';
import { createToolRunner } from './toolResult.js';
import { registerAppendBlocksTool } from './tools/appendBlocks.js';
import { registerCreatePageTool } from './tools/createPage.js';
import { registerGetPageTool } from './tools/getPage.js';
import { registerQueryDatabaseTool } from './tools/queryDatabase.js';
import { registerSearchPagesTool } from './tools/searchPages.js';

export const SERVER_INFO = { name: 'notion-mcp-hono', version: '0.1.0' } as const;

export function createMcpServer(gateway: NotionGateway, logger: Logger = silentLogger): McpServer {
  const server = new McpServer(SERVER_INFO, {
    capabilities: { tools: {} },
  });
  const run = createToolRunner(logger);

  registerSearchPagesTool(server, gateway, run);
  registerGetPageTool(server, gateway, run);
  registerCreatePageTool(server, gateway, run);
  registerAppendBlocksTool(server, gateway, run);
  registerQueryDatabaseTool(server, gateway, run);

  return server;
}
