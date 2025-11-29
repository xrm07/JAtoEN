import React from 'react';
import ReactDOM from 'react-dom/client';
import { PopupApp } from './popup/PopupApp';

// Load Chrome API stub in dev when not running inside an extension environment
if (import.meta.env.DEV && typeof (window as any).chrome === 'undefined') {
  // Top-level await is supported (ESNext modules)
  await import('./stubs/chrome');
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('Popup root element not found.');
}

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <PopupApp />
  </React.StrictMode>
);
