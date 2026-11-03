// Cone-local harness: the Wiki view over synthetic fixtures with a stand-in "shell" that persists destinations
// the way the mounted shell would (and, like it, refuses ones longer than 512 characters).
// This proves the isolated view only: not the mounted HQ shell, Electron or an installed app.

import { createElement as h, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createSyntheticService } from '../fixtures/synthetic.ts';
import { createWikiView } from '../src/index.ts';
import '../src/wiki-view.css';
import './harness.css';

const params = new URLSearchParams(window.location.search);
const View = createWikiView(createSyntheticService());
const SHELL_LIMIT = 512;

function Shell() {
  const [destination, setDestination] = useState(params.get('dest') ?? 'home');
  const [appearance, setAppearance] = useState<'light' | 'dark'>(params.get('appearance') === 'dark' ? 'dark' : 'light');
  const [requests, setRequests] = useState<readonly string[]>([]);
  return h(
    'div',
    { className: 'harness-shell', 'data-appearance': appearance },
    h(
      'div',
      { className: 'harness-bar', 'data-harness': 'synthetic' },
      h('strong', null, 'Harness: synthetic fixtures. Not the HQ shell.'),
      h('button', { type: 'button', 'aria-pressed': appearance === 'light', onClick: () => setAppearance('light') }, 'Light'),
      h('button', { type: 'button', 'aria-pressed': appearance === 'dark', onClick: () => setAppearance('dark') }, 'Dark'),
      h('span', null, 'Shell destination: ', h('code', { 'data-harness-destination': true }, destination)),
      h('span', null, `Requests: ${requests.length}`),
    ),
    h(View, {
      destination,
      appearance,
      navigate: (requested: string) => {
        setRequests((previous) => [...previous, requested]);
        if (requested.length <= SHELL_LIMIT) setDestination(requested);
      },
    }),
  );
}

const root = document.getElementById('root');
if (root !== null) createRoot(root).render(h(StrictMode, null, h(Shell)));
