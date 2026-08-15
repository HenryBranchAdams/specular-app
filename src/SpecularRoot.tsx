import { useCallback } from 'react';
import { App } from './app/App';
import { SessionBoundary } from './auth/SessionBoundary';
import type { AuthenticatedSession } from './auth/session';
import { PwaUpdatePrompt } from './components/PwaUpdatePrompt';
import { createSynchronizedWorkspaceStore } from './sync/workspace-sync';

function AuthenticatedWorkspace({ session }: { session: AuthenticatedSession }) {
  const storeFactory = useCallback(
    () => createSynchronizedWorkspaceStore(session.cacheNamespace),
    [session.cacheNamespace],
  );
  return (
    <>
      <App session={session} storeFactory={storeFactory} />
      <PwaUpdatePrompt workspaceAvailable />
    </>
  );
}

export function SpecularRoot() {
  if (/^\/s\/[a-z0-9-]+$/u.test(globalThis.location.pathname)) {
    return <App />;
  }
  return (
    <SessionBoundary>
      {(session) => <AuthenticatedWorkspace key={session.cacheNamespace} session={session} />}
    </SessionBoundary>
  );
}
