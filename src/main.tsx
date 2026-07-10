import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { PwaUpdatePrompt } from './components/PwaUpdatePrompt';
import './styles.css';

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
