import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { PwaUpdatePrompt } from './components/PwaUpdatePrompt';
import './styles.css';

async function clearStaleDevelopmentPwaState(): Promise<void> {
  const removals: Promise<unknown>[] = [];
  if ('serviceWorker' in navigator) {
    removals.push(
      navigator.serviceWorker.getRegistrations().then((registrations) => (
        Promise.all(registrations.map((registration) => registration.unregister()))
      )),
    );
  }
  if ('caches' in globalThis) {
    removals.push(
      globalThis.caches.keys().then((names) => (
        Promise.all(names.map((name) => globalThis.caches.delete(name)))
      )),
    );
  }
  await Promise.all(removals);
}

if (import.meta.env.DEV) {
  void clearStaleDevelopmentPwaState().catch(() => undefined);
}

const rootElement = document.getElementById('root');

if (rootElement === null) {
  throw new Error('Specular root element was not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
    <PwaUpdatePrompt />
  </StrictMode>,
);
