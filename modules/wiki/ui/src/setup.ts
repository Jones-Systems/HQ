// Whether the Wiki can show anything yet, read when the module mounts. Two states get one calm screen each instead of
// the views' error panels: not set up (no repository is configured) and a silent host (neither read is answered).
// Anything else, including a partial failure, is left to the views.

import { Fragment, createElement as h, useEffect, useState, type ReactElement, type ReactNode } from 'react';
import type { IndexStatus, SourceDescriptor, WikiError, WikiResult, WikiService } from '../../contract/src/index.ts';
import { describeError } from './format.ts';

export type WikiSetup =
  | { readonly kind: 'ready' }
  | { readonly kind: 'not-configured' }
  | { readonly kind: 'unreachable'; readonly error: WikiError };

/**
 * The host's index status lists only configured namespaces, so an answered status with none (and no listed source)
 * means nothing is set up. Both reads failing with `unavailable` means the host did not answer.
 */
export function classifyWikiSetup(sources: WikiResult<readonly SourceDescriptor[]>, index: WikiResult<IndexStatus>): WikiSetup {
  if (index.ok) return index.value.namespaces.length === 0 && (!sources.ok || sources.value.length === 0) ? { kind: 'not-configured' } : { kind: 'ready' };
  if (!sources.ok && sources.error.code === 'unavailable' && index.error.code === 'unavailable') return { kind: 'unreachable', error: index.error };
  return { kind: 'ready' };
}

export interface WikiSetupGateProps {
  readonly service: WikiService;
  readonly appearance: 'light' | 'dark';
  /** Asks the shell to open Settings at Data sources › Local Wiki. Null: the card names the place and offers no button. */
  readonly openSettings: (() => void) | null;
  /** The Wiki view, shown after the setup check permits reading content. */
  readonly children?: ReactNode;
}

const WHERE = 'Settings › Data sources › Local Wiki';

function Frame(props: { readonly appearance: 'light' | 'dark'; readonly children?: ReactNode }): ReactElement {
  return h('div', { className: 'wiki-view', role: 'region', 'aria-label': 'Wiki', 'data-appearance': props.appearance === 'dark' ? 'dark' : 'light' }, props.children);
}

function SettingsButton(props: { readonly openSettings: (() => void) | null; readonly primary: boolean }): ReactElement | null {
  if (props.openSettings === null) return null;
  return h('button', { type: 'button', className: props.primary ? 'wiki-button wiki-button-primary' : 'wiki-button', onClick: props.openSettings }, 'Open Settings');
}

/**
 * Checks setup before mounting the view, so an unconfigured Wiki requests no content. The check runs on mount and again on
 * Check again / Try again; a check that is overtaken or outlived by its component publishes nothing.
 */
export function WikiSetupGate(props: WikiSetupGateProps): ReactElement {
  const { service, openSettings } = props;
  const [state, setState] = useState<WikiSetup | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let current = true;
    Promise.all([service.listSources(), service.indexStatus()]).then(
      ([sources, index]) => classifyWikiSetup(sources, index),
      (): WikiSetup => ({ kind: 'ready' }),
    ).then((next) => {
      if (current) setState(next);
    });
    return () => {
      current = false;
    };
  }, [service, round]);
  const again = () => setRound((value) => value + 1);

  if (state === null) {
    return h(Frame, { appearance: props.appearance },
      h('div', { className: 'wiki-loading', role: 'status', 'aria-busy': true }, 'Checking Wiki setup…'));
  }
  if (state?.kind === 'not-configured') {
    return h(
      Frame,
      { appearance: props.appearance },
      h(
        'section',
        { className: 'wiki-home', 'aria-label': 'Set up the Wiki', 'data-wiki-setup': 'not-configured' },
        h(
          'article',
          { className: 'wiki-card' },
          h('header', { className: 'wiki-card-head' }, h('h2', { className: 'wiki-card-title' }, 'Set up the Wiki')),
          h('p', null, 'No Wiki repository is set up on this device yet, so there is nothing to read or search.'),
          h('p', { className: 'wiki-muted' }, `Add a repository in ${WHERE}.`),
          h('div', { className: 'wiki-actions' }, h(SettingsButton, { openSettings, primary: true }), h('button', { type: 'button', className: 'wiki-button', onClick: again }, 'Check again')),
        ),
      ),
    );
  }
  if (state?.kind === 'unreachable') {
    const { error } = state;
    return h(
      Frame,
      { appearance: props.appearance },
      h(
        'div',
        { className: 'wiki-notice', role: 'status', 'data-wiki-setup': 'unreachable', 'data-code': error.code, 'data-reason': error.reason },
        h('strong', null, describeError(error).title),
        h('p', null, error.message),
        h('div', { className: 'wiki-actions' }, h('button', { type: 'button', className: 'wiki-button', onClick: again }, 'Try again'), h(SettingsButton, { openSettings, primary: false })),
      ),
    );
  }
  return h(Fragment, null, props.children);
}
