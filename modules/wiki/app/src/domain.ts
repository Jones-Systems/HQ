// The Wiki domain descriptor: the module-owned entry the HQ shell mounts (T2 owns the mounting and the rail).
// Pure of side effects and of `node:*`, so it loads under the Node test runner; the stylesheet import lives in index.ts.

import { createElement as h, type ComponentType, type ReactElement } from 'react';
import { createWikiView, type WikiToastPort } from '../../ui/src/index.ts';
import { createWikiClient } from './client.ts';
import type { WikiHostPort, WikiModulePort } from './port.ts';

export interface WikiDomain {
  readonly id: 'wiki';
  readonly label: 'Wiki';
  /** The view brings its own padding and fills the workspace below the context bar. */
  readonly presentation: 'fill';
  readonly Component: ComponentType<WikiModulePort>;
}

export interface WikiDomainOptions {
  /**
   * Supplies the preload bridge (the seven read-only methods) or `null` when it is absent. Read on every call, so a
   * bridge that appears after load is used. The module never names, discovers or reaches for a global itself.
   */
  readonly getPort: () => WikiHostPort | null;
  /** The shell's toast API (structural; see `WikiToastPort`). Optional: without it the view reports inline only. */
  readonly toast?: WikiToastPort | null;
  /** Asks the shell to open Settings at Data sources › Local Wiki. Optional: without it the action is not offered. */
  readonly openSettings?: (() => void) | null;
}

/**
 * Builds the Wiki domain. The view component is created once, so its session (in-session history, recent pages and
 * loaded pages) survives re-renders and remounts alike; the shell persists the destination it is asked to.
 * Navigation here only changes what is displayed; it can never start work.
 */
export function createWikiDomain(options: WikiDomainOptions): WikiDomain {
  const View = createWikiView(createWikiClient(options.getPort), { toast: options.toast ?? null, openSettings: options.openSettings ?? null });

  function WikiModule(props: WikiModulePort): ReactElement {
    return h(
      'div',
      { className: 'wiki-domain', 'data-domain': 'wiki' },
      h(View, { destination: props.destination, appearance: props.appearance, navigate: props.navigate }),
    );
  }

  return Object.freeze({ id: 'wiki', label: 'Wiki', presentation: 'fill', Component: WikiModule });
}
