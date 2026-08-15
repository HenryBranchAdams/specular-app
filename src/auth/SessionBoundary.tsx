import { useEffect, useState, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import {
  loadBrowserSession,
  type AuthenticatedSession,
  type BrowserSession,
} from './session';

export interface SessionBoundaryProps {
  children: (session: AuthenticatedSession) => ReactNode;
  loadSession?: () => Promise<BrowserSession>;
  revalidationIntervalMs?: number;
}

export function SessionBoundary({
  children,
  loadSession = loadBrowserSession,
  revalidationIntervalMs = 60_000,
}: SessionBoundaryProps) {
  const [session, setSession] = useState<BrowserSession | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let verification: Promise<void> | null = null;
    const verify = () => {
      if (verification !== null) return;
      verification = loadSession().then((next) => {
        if (!active) return;
        setFailed(false);
        setSession(next);
      }).catch(() => {
        if (!active) return;
        setSession(null);
        setFailed(true);
      }).finally(() => { verification = null; });
    };
    const verifyWhenVisible = () => {
      if (globalThis.document.visibilityState === 'visible') verify();
    };
    verify();
    const interval = globalThis.setInterval(verify, revalidationIntervalMs);
    globalThis.addEventListener('focus', verify);
    globalThis.document.addEventListener('visibilitychange', verifyWhenVisible);
    return () => {
      active = false;
      globalThis.clearInterval(interval);
      globalThis.removeEventListener('focus', verify);
      globalThis.document.removeEventListener('visibilitychange', verifyWhenVisible);
    };
  }, [loadSession, revalidationIntervalMs]);

  if (failed) {
    return (
      <main className="session-gate">
        <span className="session-gate__brand">Specular</span>
        <p role="alert">Specular could not verify your ChatGPT session. Reload when your connection returns.</p>
      </main>
    );
  }
  if (session === null) {
    return <main className="workspace-loading"><span>Specular</span><LoaderCircle aria-label="Verifying ChatGPT session" className="spin" /></main>;
  }
  if (!session.authenticated) {
    return (
      <main className="session-gate">
        <span className="session-gate__brand">Specular</span>
        <div>
          <h1>Your private thinking workspace</h1>
          <p>Sign in before Specular opens or reads a workspace on this device.</p>
          <a className="primary-action" href={session.signInUrl}>Sign in with ChatGPT</a>
        </div>
      </main>
    );
  }
  return children(session);
}
