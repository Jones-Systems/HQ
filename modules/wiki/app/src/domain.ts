// The Wiki domain descriptor: the module-owned entry the HQ shell mounts (T2 owns the mounting and the rail).
// Pure of side effects and of `node:*`, so it loads under the Node test runner; the stylesheet import lives in index.ts.

import { createElement as h, type ComponentType, type ReactElement } from 'react';
import { WikiSetupGate, createWikiView } from '../../ui/src/index.ts';
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
  /**
   * Asks the shell to open Settings at Data sources › Local Wiki, offered on the not-set-up card and the silent-host
   * notice. Optional: without it those screens name the place and offer no button.
   */
  readonly openSettings?: (() => void) | null;
}

/**
 * Builds the Wiki domain. The view component is created once, so its identity (and therefore the view's in-session
 * history and loaded pages) survives every remount-free re-render; the shell persists the destination it is asked to.
 * Navigation here only changes what is displayed; it can never start work. Before the view, a status check shows one
 * set-up card when no repository is configured, or one inline notice when the host does not answer.
 */
export function createWikiDomain(options: WikiDomainOptions): WikiDomain {
  const service = createWikiClient(options.getPort);
  const View = createWikiView(service);
  const openSettings = options.openSettings ?? null;

  function WikiModule(props: WikiModulePort): ReactElement {
    return h(
      'div',
      { className: 'wiki-domain', 'data-domain': 'wiki' },
      h(
        WikiSetupGate,
        { service, appearance: props.appearance, openSettings },
        h(View, { destination: props.destination, appearance: props.appearance, navigate: props.navigate }),
      ),
    );
  }

  return Object.freeze({ id: 'wiki', label: 'Wiki', presentation: 'fill', Component: WikiModule });
}
