// Fallback descriptor overrides to allow third-party library polyfills to assign to fetch and other globals safely
(function() {
  try {
    const targets = [];
    if (typeof window !== 'undefined') targets.push(window);
    if (typeof globalThis !== 'undefined') targets.push(globalThis);
    if (typeof self !== 'undefined') targets.push(self);

    const keys = ['fetch', 'Headers', 'Request', 'Response'];

    targets.forEach(target => {
      if (!target) return;
      keys.forEach(key => {
        try {
          if (key in target) {
            const originalVal = target[key];
            let currentVal = originalVal;
            Object.defineProperty(target, key, {
              get() { return currentVal; },
              set(val) { currentVal = val; },
              configurable: true,
              enumerable: true
            });
          }
        } catch (innerErr) {
          // Ignore silent errors for individual properties
        }
      });
    });
  } catch (e) {
    console.warn("Failed to patch global descriptors in main.tsx:", e);
  }
})();

import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
