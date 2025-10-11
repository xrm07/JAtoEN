import React from 'react';
import ReactDOM from 'react-dom/client';
import { PopupApp } from './popup/PopupApp';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Popup root element not found.');
}

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <PopupApp />
  </React.StrictMode>
);
