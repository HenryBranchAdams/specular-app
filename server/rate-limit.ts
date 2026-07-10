interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  consume(key: string): RateLimitDecision;
}

export interface RateLimiterOptions {
  windowMs: number;
  maximum: number;
  maximumKeys?: number;
  now?: () => number;
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const entries = new Map<string, RateLimitEntry>();
  const now = options.now ?? Date.now;
  const maximumKeys = options.maximumKeys ?? 10_000;
  if (!Number.isSafeInteger(maximumKeys) || maximumKeys < 1) {
    throw new Error('maximumKeys must be a positive integer.');
  }

  const makeRoom = (timestamp: number): void => {
    if (entries.size < maximumKeys) {
      return;
    }
    for (const [entryKey, entry] of entries) {
      if (timestamp >= entry.resetAt) {
        entries.delete(entryKey);
      }
    }
    while (entries.size >= maximumKeys) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) {
        return;
      }
      entries.delete(oldest);
    }
  };

  return {
    consume(key: string): RateLimitDecision {
      const timestamp = now();
      const current = entries.get(key);
      if (current === undefined || timestamp >= current.resetAt) {
        if (current !== undefined) {
          entries.delete(key);
        }
        makeRoom(timestamp);
        entries.set(key, { count: 1, resetAt: timestamp + options.windowMs });
        return { allowed: true, retryAfterSeconds: 0 };
      }

      if (current.count >= options.maximum) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - timestamp) / 1000)),
        };
      }

      current.count += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}
