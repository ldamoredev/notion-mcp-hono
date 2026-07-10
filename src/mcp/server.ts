import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NotionGateway } from '../notion/gateway.js';
import { registerAppendBlocksTool } from './tools/appendBlocks.js';
import { registerCreatePageTool } from './tools/createPage.js';
import { registerGetPageTool } from './tools/getPage.js';
import { registerQueryDatabaseTool } from './tools/queryDatabase.js';
import { registerSearchPagesTool } from './tools/searchPages.js';

export const SERVER_INFO = { name: 'notion-mcp-hono', version: '0.1.0' } as const;

export function createMcpServer(gateway: NotionGateway): McpServer {
  const server = new McpServer(SERVER_INFO, {
    capabilities: { tools: {} },
  });

  registerSearchPagesTool(server, gateway);
  registerGetPageTool(server, gateway);
  registerCreatePageTool(server, gateway);
  registerAppendBlocksTool(server, gateway);
  registerQueryDatabaseTool(server, gateway);

  return server;
}
