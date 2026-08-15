import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import {
  clearCachedSession,
  loadBrowserSession,
  type AuthenticatedSession,
  type BrowserSession,
} from './session';
import { subscribeAuthenticationLost } from './authentication-loss';
import { PlatformSignInLink } from './PlatformSignInLink';

const SIGN_IN_URL = '/signin-with-chatgpt?return_to=%2F';

export interface SessionBoundaryProps {
  children: (session: AuthenticatedSession) => ReactNode;
  loadSession?: () => Promise<BrowserSession>;
  revalidationIntervalMs?: number;
}

export interface SessionGateProps {
  action?: ReactNode;
  alert?: boolean;
  description: string;
  title: string;
}

export function SessionGate({ action, alert = false, description, title }: SessionGateProps) {
  return (
    <main className="session-gate" data-ui-surface="session-boundary">
      <span className="session-gate__brand">Specular</span>
      <section className="session-gate__content">
        <h1>{title}</h1>
        <p role={alert ? 'alert' : undefined}>{description}</p>
        {action === undefined ? null : <div className="session-gate__actions">{action}</div>}
      </section>
    </main>
  );
}

export function SessionBoundary({
  children,
  loadSession = loadBrowserSession,
  revalidationIntervalMs = 60_000,
}: SessionBoundaryProps) {
  const [session, setSession] = useState<BrowserSession | null>(null);
  const [failed, setFailed] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const verifiedSession = useRef<AuthenticatedSession | null>(null);

  useEffect(() => {
    let active = true;
    let verification: Promise<void> | null = null;
    const verify = () => {
      if (verification !== null) return;
      if (!globalThis.navigator.onLine && verifiedSession.current !== null) return;
      verification = loadSession().then((next) => {
        if (!active) return;
        verifiedSession.current = next.authenticated ? next : null;
        setFailed(false);
        setSession(next);
      }).catch(() => {
        if (!active) return;
        verifiedSession.current = null;
        setSession(null);
        setFailed(true);
      }).finally(() => { verification = null; });
    };
    const verifyWhenVisible = () => {
      if (globalThis.document.visibilityState === 'visible') verify();
    };
    const authenticationLost = () => {
      clearCachedSession();
      verifiedSession.current = null;
      setFailed(false);
      setSession({ authenticated: false, signInUrl: SIGN_IN_URL });
      verify();
    };
    verify();
    const interval = globalThis.setInterval(verify, revalidationIntervalMs);
    globalThis.addEventListener('focus', verify);
    globalThis.addEventListener('online', verify);
    globalThis.addEventListener('pageshow', verify);
    globalThis.document.addEventListener('visibilitychange', verifyWhenVisible);
    const unsubscribeAuthenticationLost = subscribeAuthenticationLost(authenticationLost);
    return () => {
      active = false;
      globalThis.clearInterval(interval);
      globalThis.removeEventListener('focus', verify);
      globalThis.removeEventListener('online', verify);
      globalThis.removeEventListener('pageshow', verify);
      globalThis.document.removeEventListener('visibilitychange', verifyWhenVisible);
      unsubscribeAuthenticationLost();
    };
  }, [loadSession, revalidationIntervalMs, retryVersion]);

  if (failed) {
    return (
      <SessionGate
        action={(
          <button
            className="primary-action"
            onClick={() => {
              setFailed(false);
              setSession(null);
              setRetryVersion((version) => version + 1);
            }}
            type="button"
          >
            Try again
          </button>
        )}
        alert
        description="Specular could not verify your ChatGPT session. Your private workspace stayed closed. Check your connection, then try again."
        title="We couldn’t verify this session"
      />
    );
  }
  if (session === null) {
    return <main className="workspace-loading" data-ui-surface="session-boundary"><span>Specular</span><LoaderCircle aria-label="Verifying ChatGPT session" className="spin" /></main>;
  }
  if (!session.authenticated) {
    return (
      <SessionGate
        action={<PlatformSignInLink className="primary-action" href={session.signInUrl}>Sign in with ChatGPT</PlatformSignInLink>}
        description="Sign in before Specular opens or reads a workspace on this device."
        title="Your private thinking workspace"
      />
    );
  }
  return children(session);
}
