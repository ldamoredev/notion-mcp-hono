import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { bearerAuth } from './auth.js';

const KEY = 'test-secret-key';

function guardedApp() {
  const app = new Hono();
  app.use('/protected', bearerAuth(KEY));
  app.all('/protected', (c) => c.json({ ok: true }));
  return app;
}

describe('bearerAuth middleware', () => {
  it('passes a request with the valid token through', async () => {
    const res = await guardedApp().request('/protected', {
      headers: { authorization: `Bearer ${KEY}` },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it('401s when the Authorization header is missing, naming the expected header', async () => {
    const res = await guardedApp().request('/protected');

    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Bearer');
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('unauthorized');
    expect(body.message).toContain('Authorization: Bearer');
  });

  it('401s on a wrong token', async () => {
    const res = await guardedApp().request('/protected', {
      headers: { authorization: 'Bearer wrong-key' },
    });

    expect(res.status).toBe(401);
  });

  it('401s on a non-Bearer scheme', async () => {
    const res = await guardedApp().request('/protected', {
      headers: { authorization: `Basic ${btoa(`user:${KEY}`)}` },
    });

    expect(res.status).toBe(401);
  });

  it('401s on a token that is a prefix of the real key (no length leak shortcut)', async () => {
    const res = await guardedApp().request('/protected', {
      headers: { authorization: `Bearer ${KEY.slice(0, -1)}` },
    });

    expect(res.status).toBe(401);
  });

  it('never echoes the expected key in the 401 body', async () => {
    const res = await guardedApp().request('/protected', {
      headers: { authorization: 'Bearer nope' },
    });

    expect(JSON.stringify(await res.json())).not.toContain(KEY);
  });
});
