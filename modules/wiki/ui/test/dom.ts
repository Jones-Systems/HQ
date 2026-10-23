// Test harness: a happy-dom window installed as the global DOM, plus small React helpers.
// Import this module first; React DOM reads the globals when it loads.

import { Window } from 'happy-dom';

const win = new Window({ url: 'http://127.0.0.1/', width: 1024, height: 768 });

const OVERRIDE = ['Event', 'EventTarget', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'InputEvent', 'FocusEvent', 'SubmitEvent', 'AbortController', 'AbortSignal', 'MutationObserver'];
for (const name of Object.getOwnPropertyNames(win)) {
  if (name in globalThis && !OVERRIDE.includes(name)) continue;
  if (name === 'window' || name === 'self' || name === 'globalThis' || name === 'top' || name === 'parent') continue;
  try {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: (win as unknown as Record<string, unknown>)[name] });
  } catch {
    // Some accessors cannot be redefined; React DOM does not need them.
  }
}
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: win });
Object.defineProperty(globalThis, 'self', { configurable: true, writable: true, value: win });
Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: win.document });
Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: win.navigator });
(globalThis as Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = true;

export const dom = win;
