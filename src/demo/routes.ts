import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Context } from 'hono';
import { z, ZodError } from 'zod';
import type { Logger } from '../logger.js';
import { silentLogger } from '../logger.js';
import { getPageInput } from '../mcp/tools/getPage.js';
import { queryDatabaseInput } from '../mcp/tools/queryDatabase.js';
import { searchPagesInput } from '../mcp/tools/searchPages.js';
import { NotionError } from '../notion/gateway.js';
import type { NotionGateway, QueryDatabaseParams } from '../notion/gateway.js';
import { createRateLimiter } from './rateLimit.js';
import type { RateLimitOptions } from './rateLimit.js';

export interface DemoRoutesConfig {
  /** Gateway for the dedicated demo workspace (DEMO_NOTION_TOKEN). Unset → 503. */
  gateway?: NotionGateway;
  rateLimit?: RateLimitOptions;
  logger?: Logger;
}

interface DemoTool {
  /** Visitor-facing description (the MCP descriptions are written for LLMs). */
  description: string;
  /** JSON Schema derived from the same zod shape the MCP tool validates with. */
  inputSchema: Record<string, unknown>;
  execute(gateway: NotionGateway, input: unknown): Promise<unknown>;
}

function demoTool<Shape extends z.ZodRawShape>(
  shape: Shape,
  description: string,
  run: (gateway: NotionGateway, input: z.output<z.ZodObject<Shape>>) => Promise<unknown>,
): DemoTool {
  const schema = z.object(shape);
  return {
    description,
    inputSchema: z.toJSONSchema(schema) as Record<string, unknown>,
    execute: (gateway, input) => run(gateway, schema.parse(input)),
  };
}

/**
 * The demo surface is this closed map, sharing the MCP tools' zod shapes.
 * The write tools (create_page, append_blocks) are not blocked — they have no
 * entry, so no input can reach them through /demo/*. Insertion order is the
 * playground's tab order.
 */
const DEMO_TOOLS: Record<string, DemoTool> = {
  search_pages: demoTool(
    searchPagesInput,
    'Search pages in the demo workspace by title.',
    (gateway, { query, limit }) =>
      limit === undefined ? gateway.searchPages(query) : gateway.searchPages(query, limit),
  ),
  get_page: demoTool(
    getPageInput,
    'Fetch one page as clean markdown.',
    (gateway, { page_id }) => gateway.getPageMarkdown(page_id),
  ),
  query_database: demoTool(
    queryDatabaseInput,
    'Query a database with optional Notion filters, sorts, and paging.',
    (gateway, input) => {
      const params: QueryDatabaseParams = {
        databaseId: input.database_id,
        ...(input.filter !== undefined && { filter: input.filter }),
        ...(input.sorts !== undefined && { sorts: input.sorts }),
        ...(input.page_size !== undefined && { pageSize: input.page_size }),
        ...(input.start_cursor !== undefined && { startCursor: input.start_cursor }),
      };
      return gateway.queryDatabase(params);
    },
  ),
};

/** Static playground metadata: name, visitor description, JSON Schema per tool. */
const TOOL_LISTING = {
  tools: Object.entries(DEMO_TOOLS).map(([name, { description, inputSchema }]) => ({
    name,
    description,
    inputSchema,
  })),
};

const MAX_DEMO_BODY_BYTES = 32 * 1024; // tool arguments only — far below the MCP route's 2 MiB

function clientKey(c: Context): string {
  // Railway terminates TLS and sets x-forwarded-for; first hop is the visitor.
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

function invalidInputMessage(error: ZodError): string {
  return error.issues
    .map((issue) => (issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
    .join('; ');
}

export function createDemoRoutes(config: DemoRoutesConfig = {}): Hono {
  const { gateway, rateLimit = {}, logger = silentLogger } = config;
  const { limit: ratePerWindow = 10 } = rateLimit;
  const checkRateLimit = createRateLimiter(rateLimit);
  const app = new Hono();

  app.use(
    bodyLimit({
      maxSize: MAX_DEMO_BODY_BYTES,
      onError: (c) =>
        c.json({ error: 'payload_too_large', message: 'Demo request bodies are limited to 32 KiB.' }, 413),
    }),
  );

  // Static metadata the playground builds its forms from — works with the
  // demo disabled too, so the UI can render and explain the 503.
  app.get('/tools', (c) => c.json(TOOL_LISTING));

  app.post('/run/:tool', async (c) => {
    if (!gateway) {
      return c.json(
        {
          error: 'demo_disabled',
          message: 'The live demo is not configured on this deployment (DEMO_NOTION_TOKEN is unset).',
        },
        503,
      );
    }

    const decision = checkRateLimit(clientKey(c));
    if (!decision.allowed) {
      c.header('Retry-After', String(decision.retryAfterSeconds));
      return c.json(
        {
          error: 'rate_limited',
          message:
            `The demo allows ${ratePerWindow} requests per minute per visitor — ` +
            `try again in ${decision.retryAfterSeconds}s.`,
        },
        429,
      );
    }

    const toolName = c.req.param('tool');
    // Object.hasOwn keeps inherited keys (__proto__, constructor) out of the lookup.
    const tool = Object.hasOwn(DEMO_TOOLS, toolName) ? DEMO_TOOLS[toolName] : undefined;
    if (!tool) {
      return c.json(
        {
          error: 'unknown_tool',
          message:
            'Unknown demo tool. The demo exposes the read-only tools only: ' +
            'search_pages, get_page, query_database.',
        },
        404,
      );
    }

    let input: unknown;
    try {
      input = await c.req.json();
    } catch {
      return c.json(
        { error: 'invalid_json', message: 'The request body must be a JSON object of tool arguments.' },
        400,
      );
    }

    const start = performance.now();
    const durationMs = () => Math.round(performance.now() - start);
    try {
      const result = await tool.execute(gateway, input);
      logger.info('demo_tool_call', { tool: toolName, outcome: 'ok', durationMs: durationMs() });
      return c.json({ ok: true, tool: toolName, result });
    } catch (error) {
      if (error instanceof ZodError) {
        return c.json({ error: 'invalid_input', message: invalidInputMessage(error) }, 400);
      }
      if (error instanceof NotionError) {
        logger.info('demo_tool_call', { tool: toolName, outcome: error.code, durationMs: durationMs() });
        return c.json({ error: 'notion_error', message: error.message }, 502);
      }
      logger.error('demo_tool_failed', {
        tool: toolName,
        durationMs: durationMs(),
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
      return c.json(
        { error: 'internal', message: 'Unexpected server error while running the demo tool. Try again shortly.' },
        500,
      );
    }
  });

  return app;
}
