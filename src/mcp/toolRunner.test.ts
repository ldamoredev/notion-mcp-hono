import { describe, expect, it } from 'vitest';
import type { Logger } from '../logger.js';
import { NotionError } from '../notion/gateway.js';
import { createToolRunner, textResult } from './toolResult.js';

function captured() {
  const events: Array<{ level: string; event: string; fields?: Record<string, unknown> }> = [];
  const logger: Logger = {
    info: (event, fields) => events.push({ level: 'info', event, ...(fields && { fields }) }),
    error: (event, fields) => events.push({ level: 'error', event, ...(fields && { fields }) }),
  };
  return { events, logger };
}

describe('createToolRunner', () => {
  it('returns the operation result and logs the call with its duration', async () => {
    const { events, logger } = captured();
    const run = createToolRunner(logger);

    const result = await run('search_pages', async () => textResult({ ok: true }));

    expect(result.isError).toBeFalsy();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ level: 'info', event: 'tool_call' });
    expect(events[0]?.fields).toMatchObject({ tool: 'search_pages', outcome: 'ok' });
    expect(events[0]?.fields?.durationMs).toBeTypeOf('number');
  });

  it('turns NotionError into an in-band error with its curated message', async () => {
    const { events, logger } = captured();
    const run = createToolRunner(logger);

    const result = await run('get_page', async () => {
      throw new NotionError('not_found', 'Page X not found. Share it with the integration.');
    });

    expect(result).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'Page X not found. Share it with the integration.' }],
    });
    expect(events[0]?.fields).toMatchObject({ tool: 'get_page', outcome: 'not_found' });
  });

  it('never leaks unexpected error internals to the client, but logs them', async () => {
    const { events, logger } = captured();
    const run = createToolRunner(logger);

    const result = await run('query_database', async () => {
      throw new Error('ECONNREFUSED 10.0.0.5:5432 secret-internal-detail');
    });

    expect(result.isError).toBe(true);
    const text = JSON.stringify(result.content);
    expect(text).not.toContain('secret-internal-detail');
    expect(text).toContain('query_database');
    expect(text).toMatch(/unexpected server error/i);

    expect(events[0]).toMatchObject({ level: 'error', event: 'tool_call_failed' });
    expect(events[0]?.fields?.error).toContain('secret-internal-detail');
  });
});
