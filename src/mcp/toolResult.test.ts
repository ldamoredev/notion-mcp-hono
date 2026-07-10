import { describe, expect, it } from 'vitest';
import { NotionError } from '../notion/gateway.js';
import { withNotionError } from './toolResult.js';

describe('withNotionError', () => {
  it('returns NotionError messages in-band for the calling model', async () => {
    const result = await withNotionError(async () => {
      throw new NotionError('rate_limited', 'Wait a few seconds and retry.');
    });

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'Wait a few seconds and retry.' }],
    });
  });

  it('does not hide unexpected programming or infrastructure errors', async () => {
    const error = new Error('connection pool is closed');

    await expect(
      withNotionError(async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });
});
