import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startTelegramApp } from './lib/telegramApp';
import './styles/index.css';
import './styles/prose.css';

// Before the first render: inside Telegram the app opens as a half-height sheet
// until it asks for the full window.
startTelegramApp();

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Only in the built app: in development a worker would sit between the page and
// Vite's hot reload for no gain.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
