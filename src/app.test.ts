import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('GET /health', () => {
  it('returns 200 with a JSON status body', async () => {
    const app = createApp();

    const res = await app.request('/health');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    await expect(res.json()).resolves.toEqual({ status: 'ok' });
  });

  it('does not require an Authorization header', async () => {
    const app = createApp();

    const res = await app.request('/health', { headers: {} });

    expect(res.status).toBe(200);
  });
});

describe('unknown routes', () => {
  it('returns 404 as JSON', async () => {
    const app = createApp();

    const res = await app.request('/nope');

    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
  });
});
