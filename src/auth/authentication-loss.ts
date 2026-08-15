const AUTHENTICATION_LOST_EVENT = 'specular:authentication-lost';

export function reportAuthenticationLost(): void {
  globalThis.dispatchEvent(new Event(AUTHENTICATION_LOST_EVENT));
}

export function subscribeAuthenticationLost(listener: () => void): () => void {
  globalThis.addEventListener(AUTHENTICATION_LOST_EVENT, listener);
  return () => { globalThis.removeEventListener(AUTHENTICATION_LOST_EVENT, listener); };
}
