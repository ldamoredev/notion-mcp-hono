export interface RateLimitOptions {
  /** Requests allowed per key per window. Default 10. */
  limit?: number;
  /** Window length in milliseconds. Default 60 000 (one minute). */
  windowMs?: number;
  /** Clock, injectable for tests. Default Date.now. */
  now?: () => number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Whole seconds until the current window ends; 0 when allowed. */
  retryAfterSeconds: number;
}

export type RateLimiter = (key: string) => RateLimitDecision;

/** Expired entries are pruned once the map reaches this size, bounding memory. */
const MAX_TRACKED_KEYS = 10_000;

/**
 * Fixed-window counter per key, in memory. State is per process and resets on
 * deploy — the right trade-off for protecting a public demo, not an SLA device.
 */
export function createRateLimiter(options: RateLimitOptions = {}): RateLimiter {
  const { limit = 10, windowMs = 60_000, now = Date.now } = options;
  const windows = new Map<string, { windowStart: number; count: number }>();

  return (key) => {
    const t = now();

    if (windows.size >= MAX_TRACKED_KEYS) {
      for (const [trackedKey, window] of windows) {
        if (t - window.windowStart >= windowMs) windows.delete(trackedKey);
      }
    }

    const window = windows.get(key);
    if (!window || t - window.windowStart >= windowMs) {
      windows.set(key, { windowStart: t, count: 1 });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (window.count < limit) {
      window.count += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    }
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((window.windowStart + windowMs - t) / 1000),
    };
  };
}
