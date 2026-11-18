// Wiki-local feedback pieces that follow the shared HQ motion-and-feedback design (docs/design/hq-visual-system/
// motion-and-feedback.md): notices in place of full-screen errors, status shapes with words, and skeletons shaped
// like the content. The Wiki cannot import the shared UI kit (it must load under the Node test runner), so these
// mirror its look through the shared --hq-* tokens. Everything user-visible is a React text child.

import { createElement as h, type ReactElement, type ReactNode } from 'react';
import type { WikiError } from '../../contract/src/index.ts';
import { describeError } from './format.ts';
import { Icon, type IconName } from './icons.ts';

export type NoticeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface NoticeAction {
  readonly label: string;
  readonly onAction: () => void;
  /** Shows a spinner and the busy label; activation is ignored while busy. */
  readonly busy?: boolean;
  readonly busyLabel?: string;
  /** Leading icon. */
  readonly icon?: IconName;
}

const TONE_ICON: Readonly<Record<NoticeTone, IconName>> = { neutral: 'info', info: 'info', success: 'check', warning: 'alert', danger: 'alert' };

export interface NoticeProps {
  readonly tone: NoticeTone;
  /** What happened, in a few plain words. */
  readonly title: string;
  /** What it means and what was kept. */
  readonly children?: ReactNode;
  readonly actions?: readonly NoticeAction[];
  /** `banner` (default) is a soft panel; `bar` is one compact line above a list; `empty` centres a calm empty state. */
  readonly variant?: 'banner' | 'bar' | 'empty';
  /** Default: assertive (`alert`) for danger, polite (`status`) otherwise; `off` for notices present on load. */
  readonly live?: 'polite' | 'assertive' | 'off';
  /** Extra `data-*` hooks (for example `data-state`, `data-code`, `data-reason`, `data-notice`). */
  readonly data?: Readonly<Record<`data-${string}`, string>>;
  readonly className?: string;
}

export function ActionButton(props: { readonly action: NoticeAction; readonly primary?: boolean }): ReactElement {
  const { action } = props;
  const busy = action.busy === true;
  return h(
    'button',
    {
      type: 'button',
      className: `wiki-button${props.primary === true ? ' wiki-button-primary' : ''}`,
      'aria-busy': busy || undefined,
      'aria-disabled': busy || undefined,
      onClick: () => {
        if (!busy) action.onAction();
      },
    },
    busy ? h(Icon, { name: 'refresh', spin: true }) : action.icon === undefined ? null : h(Icon, { name: action.icon }),
    busy ? (action.busyLabel ?? action.label) : action.label,
  );
}

/** A problem or status shown where the user is looking, instead of replacing the view. Tone pairs an icon with words. */
export function Notice(props: NoticeProps): ReactElement {
  const { tone, actions = [], variant = 'banner' } = props;
  const politeness = props.live ?? (tone === 'danger' ? 'assertive' : 'polite');
  const classes = ['wiki-notice', `wiki-notice--${tone}`, `wiki-notice--${variant}`];
  if (props.className !== undefined) classes.push(props.className);
  return h(
    'div',
    {
      className: classes.join(' '),
      'data-tone': tone,
      role: politeness === 'assertive' ? 'alert' : politeness === 'polite' ? 'status' : undefined,
      ...props.data,
    },
    h('span', { className: 'wiki-notice-icon' }, h(Icon, { name: TONE_ICON[tone] })),
    h(
      'div',
      { className: 'wiki-notice-text' },
      h('strong', { className: 'wiki-notice-title' }, props.title),
      props.children === undefined || props.children === null ? null : h('div', { className: 'wiki-notice-body' }, props.children),
    ),
    actions.length === 0
      ? null
      : h('div', { className: 'wiki-notice-actions' }, actions.map((action, index) => h(ActionButton, { key: action.label, action, primary: index === 0 && variant !== 'bar' }))),
  );
}

/**
 * A read failure as a notice: plain heading, what it means, the service's own message, and the recovery actions the
 * caller supplies. The raw code stays available to tests and support as data attributes and a muted mono line.
 */
export function ErrorNotice(props: {
  readonly error: WikiError;
  /** What failed to load, in words: "this page", "search results", "backlinks". */
  readonly what: string;
  readonly actions?: readonly NoticeAction[];
  readonly variant?: 'banner' | 'bar' | 'empty';
  /** An outage notice for content already shown is `warning`; a failure with nothing to show is `danger`. */
  readonly tone?: NoticeTone;
}): ReactElement {
  const text = describeError(props.error);
  return h(
    Notice,
    {
      tone: props.tone ?? 'danger',
      title: text.title,
      variant: props.variant,
      actions: props.actions,
      data: { 'data-state': 'error', 'data-code': props.error.code, 'data-reason': props.error.reason },
    },
    h('p', { className: 'wiki-notice-detail' }, `${text.detail} (${props.what})`),
    props.error.message === '' ? null : h('p', { className: 'wiki-notice-message' }, props.error.message),
    h('p', { className: 'wiki-notice-code' }, `${props.error.code} · ${props.error.reason}`),
  );
}

export type StatusTone = 'ok' | 'pending' | 'warning' | 'danger' | 'neutral';

/** Ongoing state as a shape plus a word (never colour alone), with optional mono detail. */
export function StatusChip(props: { readonly tone: StatusTone; readonly label: string; readonly detail?: string; readonly busy?: boolean }): ReactElement {
  return h(
    'span',
    { className: `wiki-status wiki-status--${props.tone}`, 'data-status': props.tone, 'aria-busy': props.busy === true || undefined },
    props.busy === true ? h(Icon, { name: 'refresh', spin: true, className: 'wiki-status-shape' }) : h('span', { className: 'wiki-status-shape', 'aria-hidden': 'true' }),
    h('span', { className: 'wiki-status-label' }, props.label),
    props.detail === undefined ? null : h('span', { className: 'wiki-status-detail' }, props.detail),
  );
}

/** Placeholder shaped like the content. Hidden from assistive technology: mark the region `aria-busy` and keep a status. */
export function Skeleton(props: { readonly shape?: 'line' | 'title' | 'block' | 'chip'; readonly lines?: number; readonly className?: string }): ReactElement {
  const shape = props.shape ?? 'line';
  const extra = props.className === undefined ? '' : ` ${props.className}`;
  if (shape === 'line' && (props.lines ?? 1) > 1) {
    const count = props.lines ?? 1;
    return h(
      'span',
      { className: `wiki-skeleton-lines${extra}`, 'aria-hidden': 'true' },
      Array.from({ length: count }, (_, index) => h('span', { key: index, className: `wiki-skeleton wiki-skeleton--line${index === count - 1 ? ' wiki-skeleton--last' : ''}` })),
    );
  }
  return h('span', { className: `wiki-skeleton wiki-skeleton--${shape}${extra}`, 'aria-hidden': 'true' });
}

/** A keyboard hint such as `/`. */
export function Kbd(props: { readonly children: string }): ReactElement {
  return h('kbd', { className: 'wiki-kbd' }, props.children);
}
