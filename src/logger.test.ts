import { describe, expect, it } from 'vitest';
import { createLogger } from './logger.js';

function captured() {
  const lines: string[] = [];
  return { lines, logger: createLogger((line) => lines.push(line)) };
}

describe('createLogger', () => {
  it('emits one JSON line per event with level, event name, and fields', () => {
    const { lines, logger } = captured();

    logger.info('http_request', { method: 'POST', status: 200 });

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!);
    expect(entry).toMatchObject({
      level: 'info',
      event: 'http_request',
      method: 'POST',
      status: 200,
    });
    expect(new Date(entry.time).getTime()).not.toBeNaN();
  });

  it('emits error-level events', () => {
    const { lines, logger } = captured();

    logger.error('tool_call_failed', { tool: 'get_page' });

    expect(JSON.parse(lines[0]!)).toMatchObject({ level: 'error', tool: 'get_page' });
  });
});
