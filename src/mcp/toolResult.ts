import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Logger } from '../logger.js';
import { NotionError } from '../notion/gateway.js';

export function textResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

export type ToolRunner = (
  tool: string,
  operation: () => Promise<CallToolResult>,
) => Promise<CallToolResult>;

/**
 * Wraps every tool invocation: NotionError becomes an in-band error with its
 * curated message; anything else becomes a generic in-band error so internals
 * never reach the client (the SDK would otherwise echo the raw message), with
 * the real error logged server-side. Also logs name/outcome/duration per call —
 * never the arguments, which can contain page content.
 */
export function createToolRunner(logger: Logger): ToolRunner {
  return async (tool, operation) => {
    const start = performance.now();
    const durationMs = () => Math.round(performance.now() - start);
    try {
      const result = await operation();
      logger.info('tool_call', { tool, outcome: 'ok', durationMs: durationMs() });
      return result;
    } catch (error) {
      if (error instanceof NotionError) {
        logger.info('tool_call', { tool, outcome: error.code, durationMs: durationMs() });
        return { isError: true, content: [{ type: 'text', text: error.message }] };
      }
      logger.error('tool_call_failed', {
        tool,
        durationMs: durationMs(),
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text:
              `Unexpected server error while running ${tool}. This is a bug in the MCP server, ` +
              'not a problem with your arguments. Retrying once may help; if it persists, ' +
              'report it to the server operator.',
          },
        ],
      };
    }
  };
}
