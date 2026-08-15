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

export type AuthenticatedSession = z.infer<typeof authenticatedSessionSchema>;
export type BrowserSession = AuthenticatedSession | z.infer<typeof anonymousSessionSchema>;
const SESSION_CACHE_KEY = 'specular-authenticated-session';

export function clearCachedSession(): void { globalThis.localStorage.removeItem(SESSION_CACHE_KEY); }

export async function loadBrowserSession(): Promise<BrowserSession> {
  try {
    const response = await fetch('/api/session', { headers: { accept: 'application/json' } });
    const body = await response.json() as unknown;
    if (response.ok) {
      const session = authenticatedSessionSchema.parse(body);
      globalThis.localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(session));
      return session;
    }
    if (response.status === 401) {
      clearCachedSession();
      return anonymousSessionSchema.parse(body);
    }
    throw new Error('session_unavailable');
  } catch (error) {
    if (globalThis.navigator.onLine) throw error;
    const cached = globalThis.localStorage.getItem(SESSION_CACHE_KEY);
    if (cached === null) throw error;
    return authenticatedSessionSchema.parse(JSON.parse(cached) as unknown);
  }
}
