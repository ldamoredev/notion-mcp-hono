import { createHash, timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

/**
 * Requires `Authorization: Bearer <expectedKey>` on every request it guards.
 * Comparison is constant-time: both sides are hashed to fixed-length digests
 * first, so neither the key's content nor its length leaks through timing.
 */
export function bearerAuth(expectedKey: string): MiddlewareHandler {
  const expectedDigest = createHash('sha256').update(expectedKey).digest();

  return async (c, next) => {
    const header = c.req.header('authorization');
    const token = header?.match(/^Bearer\s+(.+)$/i)?.[1];

    if (token === undefined || !digestsMatch(token, expectedDigest)) {
      c.header('WWW-Authenticate', 'Bearer realm="mcp"');
      return c.json(
        {
          error: 'unauthorized',
          message:
            'This endpoint requires an "Authorization: Bearer <MCP_API_KEY>" header with a valid key.',
        },
        401,
      );
    }

    await next();
  };
}

function digestsMatch(token: string, expectedDigest: Buffer): boolean {
  const tokenDigest = createHash('sha256').update(token).digest();
  return timingSafeEqual(tokenDigest, expectedDigest);
}
