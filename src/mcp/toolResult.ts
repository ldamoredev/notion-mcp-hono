import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { NotionError } from '../notion/gateway.js';

export function textResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

export async function withNotionError(
  operation: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof NotionError) {
      return {
        isError: true,
        content: [{ type: 'text', text: error.message }],
      };
    }
    throw error;
  }
}
