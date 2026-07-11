import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rateLimit.js';

function fakeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('createRateLimiter', () => {
  it('allows requests up to the limit within one window', () => {
    const clock = fakeClock();
    const check = createRateLimiter({ limit: 3, windowMs: 60_000, now: clock.now });

    expect(check('ip-a').allowed).toBe(true);
    expect(check('ip-a').allowed).toBe(true);
    expect(check('ip-a').allowed).toBe(true);
  });

  it('blocks the request over the limit and says when to retry', () => {
    const clock = fakeClock();
    const check = createRateLimiter({ limit: 2, windowMs: 60_000, now: clock.now });

    check('ip-a');
    check('ip-a');
    clock.advance(15_000);
    const decision = check('ip-a');

    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBe(45);
  });

  it('resets the counter once the window elapses', () => {
    const clock = fakeClock();
    const check = createRateLimiter({ limit: 1, windowMs: 60_000, now: clock.now });

    expect(check('ip-a').allowed).toBe(true);
    expect(check('ip-a').allowed).toBe(false);
    clock.advance(60_000);
    expect(check('ip-a').allowed).toBe(true);
  });

  it('tracks each key independently', () => {
    const clock = fakeClock();
    const check = createRateLimiter({ limit: 1, windowMs: 60_000, now: clock.now });

    expect(check('ip-a').allowed).toBe(true);
    expect(check('ip-a').allowed).toBe(false);
    expect(check('ip-b').allowed).toBe(true);
  });

  it('defaults to 10 requests per minute', () => {
    const clock = fakeClock();
    const check = createRateLimiter({ now: clock.now });

    for (let i = 0; i < 10; i++) {
      expect(check('ip-a').allowed).toBe(true);
    }
    expect(check('ip-a').allowed).toBe(false);
  });
});
