import { z } from 'zod';

const authenticatedSessionSchema = z.object({
  authenticated: z.literal(true),
  email: z.string().email(),
  cacheNamespace: z.string().min(1).max(128),
  signOutUrl: z.string().startsWith('/'),
}).strict();

const anonymousSessionSchema = z.object({
  authenticated: z.literal(false),
  signInUrl: z.string().startsWith('/'),
}).strict();
const browserSessionSchema = z.discriminatedUnion('authenticated', [
  authenticatedSessionSchema,
  anonymousSessionSchema,
]);

export type AuthenticatedSession = z.infer<typeof authenticatedSessionSchema>;
export type BrowserSession = AuthenticatedSession | z.infer<typeof anonymousSessionSchema>;
const SESSION_CACHE_KEY = 'specular-authenticated-session';

export function clearCachedSession(): void { globalThis.localStorage.removeItem(SESSION_CACHE_KEY); }

export async function loadBrowserSession(): Promise<BrowserSession> {
  const response = await fetch('/api/session', { headers: { accept: 'application/json' } });
  const body = await response.json() as unknown;
  if (response.ok) {
    clearCachedSession();
    return browserSessionSchema.parse(body);
  }
  if (response.status === 401) {
    clearCachedSession();
    return anonymousSessionSchema.parse(body);
  }
  throw new Error('session_unavailable');
}
