import {
  createElement as h, useEffect, useMemo, useRef, useState, useSyncExternalStore,
  type ComponentType, type ReactElement, type ReactNode, type RefObject,
} from 'react';
import type { ProjectId } from './contract.ts';
import {
  createImportsController, deriveStep, describeCounts, describeItemCount, EXPORT_CHOICES, formatExactTime, formatRelativeTime, IMPORT_STEPS,
  type ImportsCapabilities, type ImportsController, type ImportsControllerOptions, type ImportsOutcome, type ImportsState, type ImportsStep,
  type OutcomeWhere, type PlanKind, type PlanRow,
} from './controller.ts';
import type { ImportDeps } from './importer.ts';

/**
 * Imports surface: Choose → Review → Done, with history and export beside it. Written with createElement so Node can
 * run it without a JSX transform. Styling uses `@hq/ui` tokens; class names are section-prefixed so root can scope them.
 *
 * The motion and feedback primitives (`Presence`, `InlineNotice`, `StatusIndicator`, toasts, list motion) come from
 * `@hq/ui`, which loads stylesheets Node cannot import. So this file never imports it: the composed view passes them
 * in as `kit`, and without a kit the surface renders plainly (that is what the Node tests exercise).
 */

// ---------------------------------------------------------------------------
// Kit: the F1 primitives this surface uses, as structural types
// ---------------------------------------------------------------------------

export interface KitPresenceProps {
  readonly show: boolean;
  readonly motion?: 'fade' | 'rise' | 'collapse' | 'scale';
  readonly as?: 'div' | 'section' | 'li';
  readonly className?: string;
  readonly id?: string;
  readonly 'aria-labelledby'?: string;
  readonly children?: ReactNode;
}

export interface KitNoticeProps {
  readonly tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'unknown';
  readonly title: string;
  readonly children?: ReactNode;
  readonly actions?: readonly { readonly label: string; readonly onAction: () => void; readonly busy?: boolean; readonly busyLabel?: string }[];
  readonly onDismiss?: () => void;
  readonly live?: 'polite' | 'assertive' | 'off';
  readonly className?: string;
}

export interface KitStatusProps {
  readonly tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'unknown' | 'unavailable';
  readonly label: string;
  readonly detail?: ReactNode;
  readonly busy?: boolean;
  readonly live?: boolean;
  readonly className?: string;
}

export interface KitToastOptions {
  readonly id?: string;
  readonly description?: string;
  readonly meta?: string;
  readonly action?: { readonly label: string; readonly onAction: () => void };
}

export interface KitToast {
  success(title: string, options?: KitToastOptions): string;
  info(title: string, options?: KitToastOptions): string;
  warning(title: string, options?: KitToastOptions): string;
  error(title: string, options?: KitToastOptions): string;
  unknown(title: string, options?: KitToastOptions): string;
  dismiss(id?: string): void;
}

export interface ImportsKit {
  readonly Presence: ComponentType<KitPresenceProps>;
  readonly InlineNotice: ComponentType<KitNoticeProps>;
  readonly StatusIndicator: ComponentType<KitStatusProps>;
  readonly useToast: () => KitToast;
  readonly useListMotion: <T extends HTMLElement>(order: readonly string[]) => RefObject<T | null>;
}

const silentToast = (): string => '';
const SILENT_TOAST: KitToast = { success: silentToast, info: silentToast, warning: silentToast, error: silentToast, unknown: silentToast, dismiss: () => {} };

/** No motion and no toasts: enough to render and test the markup without `@hq/ui`. */
const PLAIN_KIT: ImportsKit = {
  Presence: (props) => (props.show ? h(props.as ?? 'div', { id: props.id, className: props.className, 'aria-labelledby': props['aria-labelledby'] }, props.children) : null),
  InlineNotice: (props) => h('div', { className: props.className, role: props.tone === 'danger' || props.tone === 'unknown' ? 'alert' : 'status', 'data-tone': props.tone },
    h('strong', null, props.title), props.children === undefined ? null : h('span', null, props.children),
    (props.actions ?? []).map((action) => h('button', { key: action.label, type: 'button', onClick: action.onAction }, action.label))),
  StatusIndicator: (props) => h('span', { className: props.className, 'data-tone': props.tone, role: props.live === false ? undefined : 'status' },
    props.label, props.detail === undefined ? null : h('span', null, props.detail)),
  useToast: () => SILENT_TOAST,
  useListMotion: <T extends HTMLElement>() => useRef<T | null>(null),
};

// ---------------------------------------------------------------------------
// Actions, copy and announcements
// ---------------------------------------------------------------------------

export interface ImportsActions {
  readonly choose: () => void;
  readonly apply: () => void;
  readonly undo: ImportsController['undo'];
  readonly resolve: ImportsController['resolve'];
  readonly setExportChoice: ImportsController['setExportChoice'];
  readonly setConfirmPrivate: ImportsController['setConfirmPrivate'];
  readonly exportNow: () => void;
  /** Back to Choose from Review or Done. */
  readonly reset?: () => void;
  /** Re-reads the store after an unconfirmed outcome. */
  readonly check?: () => void;
  readonly dismiss?: () => void;
  /** Copies text and says whether it worked. Defaults to the system clipboard when there is one. */
  readonly copy?: (text: string) => Promise<boolean>;
}

export interface ImportsCrossLink {
  /** The question or lead-in, for example "Adding single screenshots?". */
  readonly lead: string;
  /** The destination, for example "Use References → Import screenshots". */
  readonly label: string;
  readonly onOpen: () => void;
}

/** The minimum of the async Clipboard API this surface needs; a missing or refusing clipboard reports `false`. */
export interface ClipboardLike { writeText?(text: string): Promise<void> }

/** Never throws: no clipboard, a denied permission and a rejected write all return `false`. */
export async function copyText(text: string, clipboard: ClipboardLike | undefined = globalThis.navigator?.clipboard): Promise<boolean> {
  if (clipboard === undefined || typeof clipboard.writeText !== 'function') return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const applyToastId = (importId: string): string => `imports-applied-${importId}`;
/** One pending question at a time: a second unknown result updates this toast, and Check's answer withdraws it. */
const UNKNOWN_TOAST_ID = 'imports-unknown-result';

/**
 * Says an outcome as a toast. A success that can be undone offers Undo; an unconfirmed result offers Check, never a
 * blind retry. Problems also stay as an inline notice in their step, which the view renders from `state.outcome`.
 */
export function announceOutcome(outcome: ImportsOutcome, toast: KitToast, controller: Pick<ImportsController, 'undo' | 'check'>): void {
  // The Undo a toast offered is stale once that import is undone, however it got undone, so it goes away.
  if (outcome.importId !== undefined && outcome.undoable !== true && outcome.tone === 'success') toast.dismiss(applyToastId(outcome.importId));
  if (outcome.reconciles === true) toast.dismiss(UNKNOWN_TOAST_ID);
  const options: KitToastOptions = {
    ...(outcome.tone === 'unknown' ? { id: UNKNOWN_TOAST_ID } : {}),
    description: outcome.detail,
    ...(outcome.meta === undefined ? {} : { meta: outcome.meta }),
    ...(outcome.undoable === true && outcome.importId !== undefined
      ? { id: applyToastId(outcome.importId), action: { label: 'Undo', onAction: () => { void controller.undo(outcome.importId!); } } } : {}),
    ...(outcome.checkable === true ? { action: { label: 'Check', onAction: () => { void controller.check(); } } } : {}),
  };
  if (outcome.tone === 'success') toast.success(outcome.title, options);
  else if (outcome.tone === 'danger') toast.error(outcome.title, options);
  else if (outcome.tone === 'unknown') toast.unknown(outcome.title, options);
  else toast.info(outcome.title, options);
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

const formatBytes = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

const cx = (...names: readonly (string | false | undefined)[]): string => names.filter((name): name is string => typeof name === 'string' && name !== '').join(' ');

const ICONS = {
  upload: ['M12 15.5V4.5m0 0L8 8.5m4-4 4 4', 'M5 14.5v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3'],
  check: ['m5.5 12.5 4.3 4.3 8.7-9.3'],
  new: ['M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z', 'M12 8.5v7M8.5 12h7'],
  update: ['M18 8.5A7 7 0 0 0 6 8.2M6 4.8v3.4h3.4', 'M6 15.5a7 7 0 0 0 12 .3m0 3.4v-3.4h-3.4'],
  conflict: ['M12 4 21 19.5H3Z', 'M12 10v4M12 17h.01'],
  skip: ['M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z', 'M8.5 12h7'],
  rejected: ['M5.5 5.5h13v13h-13Z', 'm9.3 9.3 5.4 5.4m0-5.4-5.4 5.4'],
  copy: ['M9 9h10v10H9Z', 'M5 15V5h10'],
} as const;

function icon(name: keyof typeof ICONS, className = 'hqd-imports__icon'): ReactElement {
  return h('svg', { className, viewBox: '0 0 24 24', 'aria-hidden': true, focusable: 'false' },
    ICONS[name].map((path) => h('path', { key: path, d: path })));
}

const spinner = (): ReactElement => h('span', { className: 'hq-spinner', 'aria-hidden': true });

/** A button that keeps focus while it works: busy sets `aria-busy` and ignores activation instead of disabling. */
function actionButton(o: {
  readonly label: string; readonly busyLabel: string; readonly busy: boolean; readonly blocked: boolean;
  readonly variant: 'primary' | 'secondary' | 'ghost'; readonly small?: boolean; readonly onClick: () => void; readonly ariaLabel?: string; readonly done?: boolean;
}): ReactElement {
  return h('button', {
    type: 'button', className: cx('hq-btn', `hq-btn--${o.variant}`, o.small === true && 'hq-btn--sm'),
    onClick: o.busy || o.blocked ? undefined : o.onClick, disabled: o.blocked && !o.busy ? true : undefined,
    'aria-busy': o.busy || undefined, 'aria-label': o.busy ? undefined : o.ariaLabel,
  }, o.busy ? spinner() : o.done === true ? icon('check') : null, o.busy ? o.busyLabel : o.label);
}

/** Keeps the last non-null value so an element that is animating out still has its content. */
function useHeld<T>(value: T | null): T | null {
  const [held, setHeld] = useState<T | null>(value);
  if (value !== null && value !== held) setHeld(value);
  return value ?? held;
}

const isProblem = (outcome: ImportsOutcome | null): outcome is ImportsOutcome => outcome !== null && (outcome.tone === 'danger' || outcome.tone === 'unknown');

interface NoticeSlotProps {
  readonly kit: ImportsKit;
  readonly where: OutcomeWhere;
  readonly state: ImportsState;
  readonly actions: ImportsActions;
}

/** The inline notice a problem leaves where it happened. It slides open and shut, and keeps its words while closing. */
function NoticeSlot({ kit, where, state, actions }: NoticeSlotProps): ReactElement {
  const problem = isProblem(state.outcome) && state.outcome.where === where ? state.outcome : null;
  const held = useHeld(problem);
  const checking = state.busyAction === 'check';
  return h(kit.Presence, { show: problem !== null, motion: 'collapse', className: 'hqd-imports__notice' },
    held === null ? null : h(kit.InlineNotice, {
      tone: held.tone, title: held.title,
      actions: held.checkable === true && actions.check !== undefined ? [{ label: 'Check', onAction: actions.check, busy: checking, busyLabel: 'Checking' }] : [],
      ...(actions.dismiss === undefined ? {} : { onDismiss: actions.dismiss }),
    }, held.detail));
}

const PLAN_WORDS: Readonly<Record<PlanKind, string>> = { new: 'New', update: 'Update', skip: 'Skip', conflict: 'Conflict', rejected: 'Rejected' };
const PLAN_NOTES: Readonly<Record<PlanKind, string>> = {
  new: 'Will be added', update: 'Source changed; the record is updated', skip: 'Already up to date', conflict: 'Your edits are kept; decide after applying', rejected: '',
};
const DONE_NOTES: Readonly<Record<PlanKind, string>> = {
  new: 'Added', update: 'Updated', skip: 'Left as it was', conflict: 'Your edits kept; decision pending', rejected: '',
};
/** Undo keeps anything edited since, so an undone row says "Undone" and never claims a removal. */
const UNDONE_NOTES: Readonly<Record<PlanKind, string>> = { ...DONE_NOTES, new: 'Undone', update: 'Undone' };

function planRows(rows: readonly PlanRow[], notes: Readonly<Record<PlanKind, string>>, label: string): ReactElement {
  return h('ul', { className: 'hqd-imports__rows hq-stagger', 'aria-label': label },
    rows.map((row) => h('li', { key: `${row.kind}:${row.key}`, className: 'hqd-imports__row', 'data-kind': row.kind, 'data-tone': row.tone },
      h('span', { className: 'hqd-imports__badge' }, icon(row.kind), PLAN_WORDS[row.kind]),
      h('span', { className: 'hqd-imports__row-main' },
        h('span', { className: 'hqd-imports__key' }, row.key),
        h('span', { className: 'hqd-imports__note' }, row.kind === 'rejected' ? row.action.replaceAll('-', ' ') : notes[row.kind])))));
}

function Stepper({ step }: { readonly step: ImportsStep }): ReactElement {
  const index = IMPORT_STEPS.findIndex((item) => item.step === step);
  return h('ol', { className: 'hqd-imports__steps', 'aria-label': 'Import steps' },
    IMPORT_STEPS.map((item, position) => {
      const status = position < index ? 'done' : position === index ? 'current' : 'upcoming';
      const checked = status === 'done' || (item.step === 'done' && status === 'current');
      return h('li', { key: item.step, className: 'hqd-imports__step', 'data-state': status, 'aria-current': status === 'current' ? 'step' : undefined },
        h('span', { className: 'hqd-imports__step-mark', 'aria-hidden': true }, checked ? icon('check') : String(position + 1)),
        h('span', { className: 'hqd-imports__step-label' }, item.label),
        status === 'done' ? h('span', { className: 'hq-sr-only' }, ' (completed)') : null);
    }));
}

/** Copies the digest and reports it twice: a transient label on the button and a toast for assistive technology. */
function CopyDigest({ digest, copy, toast }: { readonly digest: string; readonly copy: (text: string) => Promise<boolean>; readonly toast: KitToast }): ReactElement {
  const [result, setResult] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onClick = () => {
    void copy(digest).then((ok) => {
      setResult(ok ? 'copied' : 'failed');
      if (ok) toast.success('Digest copied', { id: 'imports-copy-digest' });
      else toast.warning("Couldn't copy the digest", { id: 'imports-copy-digest', description: 'The clipboard is unavailable here. Select the digest and copy it by hand.' });
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setResult('idle'), 2200);
    });
  };
  return h('button', { type: 'button', className: 'hq-btn hq-btn--ghost hq-btn--sm hqd-imports__copy', onClick, 'data-result': result },
    icon(result === 'copied' ? 'check' : 'copy'), result === 'copied' ? 'Copied' : result === 'failed' ? 'Copy unavailable' : 'Copy digest');
}

// ---------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------

export interface ImportsViewProps {
  readonly state: ImportsState;
  readonly actions: ImportsActions;
  readonly kit?: ImportsKit;
  /** Wall clock (ms) for relative times; tests pin it. */
  readonly now?: number;
  readonly crossLink?: ImportsCrossLink;
}

/** Stateless over the controller's state; rendered in tests with react-dom/server. */
export function ImportsView({ state, actions, kit = PLAIN_KIT, now = Date.now(), crossLink }: ImportsViewProps): ReactElement {
  const busy = state.status === 'busy';
  const busyAction = busy ? state.busyAction : null;
  const step = deriveStep(state);
  const summary = state.summary;
  const draftChoice = state.exportChoice === 'draft-backup';
  const toast = kit.useToast();
  const copy = actions.copy ?? copyText;
  const root = useRef<HTMLElement | null>(null);
  const previousStep = useRef(step);
  const historyOrder = useMemo(() => state.history.map((entry) => entry.importId), [state.history]);
  const timeline = kit.useListMotion<HTMLOListElement>(historyOrder);
  const awaitingCheck = state.outcome?.tone === 'unknown' && state.outcome.checkable === true;
  const rejected = summary !== null && summary.rows.some((row) => row.kind === 'rejected');
  const appliedEntry = state.applied === null ? undefined : state.history.find((entry) => entry.importId === state.applied?.importId);
  const appliedUndone = appliedEntry?.undone === true;
  const flashId = state.outcome !== null && state.outcome.tone === 'success' ? state.outcome.importId : undefined;
  const slot = (where: OutcomeWhere) => h(NoticeSlot, { kit, where, state, actions });

  // A new step replaces the control that had focus, so focus follows to the new step's heading.
  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    root.current?.querySelector<HTMLElement>(`[data-step-heading="${step}"]`)?.focus({ preventScroll: true });
  }, [step]);

  const choosePanel = h(kit.Presence, { key: 'choose', show: step === 'choose', motion: 'rise', as: 'section', className: 'hqd-imports__panel hqd-imports__drop', 'aria-labelledby': 'hqd-imports-choose' },
    h('span', { className: 'hqd-imports__drop-icon', 'aria-hidden': true }, icon('upload', 'hqd-imports__icon hqd-imports__icon--lg')),
    h('h3', { id: 'hqd-imports-choose', tabIndex: -1, 'data-step-heading': 'choose' }, 'Choose files to import'),
    h('p', { className: 'hqd-imports__hint' }, 'PNG screens, MP4 or WebM recordings, HTML bundles and URLs.'),
    h('button', { type: 'button', onClick: busyAction === 'choose' ? undefined : actions.choose, disabled: !state.canPick, 'aria-busy': busyAction === 'choose' || undefined,
      'aria-describedby': state.canPick ? undefined : 'hqd-imports-pick-unavailable' }, ...(busyAction === 'choose' ? [spinner(), 'Reading files'] : ['Choose files…'])),
    state.canPick
      ? h('p', { className: 'hqd-imports__meta' }, 'Drag and drop is not available in this build.')
      : h('p', { id: 'hqd-imports-pick-unavailable', className: 'hqd-imports__unavailable' }, 'File selection is unavailable in this build.'),
    slot('choose'));

  const reviewPanel = h(kit.Presence, { key: 'review', show: step === 'review', motion: 'rise', as: 'section', className: 'hqd-imports__panel', 'aria-labelledby': 'hqd-imports-review' },
    h('h3', { id: 'hqd-imports-review', tabIndex: -1, 'data-step-heading': 'review' }, 'Review the import'),
    // A rejection says what is wrong in the notice below, so its words are not repeated here.
    summary === null || rejected ? null : h('p', { className: 'hqd-imports__headline', role: 'status' }, summary.headline),
    summary === null || summary.detail === '' || rejected ? null : h('p', { className: 'hqd-imports__detail' }, summary.detail),
    slot('review'),
    summary === null || summary.rows.length === 0 ? null : planRows(summary.rows, PLAN_NOTES, 'Import preview'),
    h(kit.Presence, { show: busyAction === 'apply', motion: 'collapse', className: 'hqd-imports__progress-slot' },
      h('div', { className: 'hqd-imports__progress', role: 'progressbar', 'aria-label': 'Importing', 'aria-busy': true }, h('span', null)),
      h(kit.StatusIndicator, { tone: 'neutral', busy: true, label: 'Importing', detail: summary === null ? undefined : `${summary.rows.length} items`, live: true })),
    h('div', { className: 'hqd-imports__actions' },
      actionButton({ label: 'Choose different files', busyLabel: 'Choose different files', busy: false, blocked: busy, variant: 'ghost', onClick: actions.reset ?? (() => {}) }),
      state.applied !== null || (summary !== null && summary.canApply)
        ? actionButton({ label: state.applied !== null ? 'Imported' : 'Apply import', busyLabel: 'Importing', busy: busyAction === 'apply', blocked: busy || awaitingCheck || state.applied !== null, variant: 'primary', onClick: actions.apply, done: state.applied !== null })
        : null));

  const applied = state.applied;
  const appliedKeys = applied === null ? [] : applied.rows.filter((row) => row.kind === 'new' || row.kind === 'update').map((row) => row.key);
  const donePanel = h(kit.Presence, { key: 'done', show: step === 'done', motion: 'rise', as: 'section', className: 'hqd-imports__panel hqd-imports__done', 'aria-labelledby': 'hqd-imports-done' },
    h('div', { className: 'hqd-imports__done-head' },
      h('span', { className: 'hqd-imports__done-mark hq-enter-scale', 'data-undone': appliedUndone, 'aria-hidden': true }, icon(appliedUndone ? 'skip' : 'check', 'hqd-imports__icon hqd-imports__icon--lg')),
      h('div', null,
        h('h3', { id: 'hqd-imports-done', tabIndex: -1, 'data-step-heading': 'done' },
          applied === null || appliedKeys.length === 0 ? (appliedUndone ? 'Import undone' : 'Import applied')
            : appliedUndone ? `Undid the import of ${describeItemCount(appliedKeys.length, appliedKeys)}` : `Imported ${describeItemCount(appliedKeys.length, appliedKeys)}`),
        applied === null ? null : h('p', { className: 'hqd-imports__detail' }, describeCounts(applied.counts)))),
    applied === null ? null : h('p', { className: 'hqd-imports__done-status' },
      h(kit.StatusIndicator, { tone: appliedUndone ? 'neutral' : 'success', label: appliedUndone ? 'Undone' : 'Applied', live: false,
        detail: h('time', { dateTime: applied.importedAt, title: formatExactTime(applied.importedAt) }, formatRelativeTime(applied.importedAt, now)) })),
    slot('done'),
    applied === null || applied.rows.length === 0 ? null : planRows(applied.rows, appliedUndone ? UNDONE_NOTES : DONE_NOTES, appliedUndone ? 'What was undone' : 'What landed'),
    h('div', { className: 'hqd-imports__actions' },
      applied === null || appliedUndone ? null : actionButton({
        label: 'Undo import', busyLabel: 'Undoing', busy: busyAction === 'undo' && state.busyId === applied.importId, blocked: busy, variant: 'secondary', onClick: () => void actions.undo(applied.importId),
      }),
      actionButton({ label: 'Import more', busyLabel: 'Import more', busy: false, blocked: busy, variant: 'primary', onClick: actions.reset ?? (() => {}) })));

  const conflicts = state.conflicts.length === 0 ? null : h('section', { key: 'conflicts', className: 'hqd-imports__panel hqd-imports__conflicts hq-enter-rise', 'aria-labelledby': 'hqd-imports-conflicts' },
    h('div', { className: 'hqd-imports__panel-head' },
      h('h3', { id: 'hqd-imports-conflicts' }, `Conflicts (${state.conflicts.length})`),
      h(kit.StatusIndicator, { tone: 'warning', label: 'Needs your decision', live: false })),
    slot('conflicts'),
    h('ul', { className: 'hqd-imports__rows' }, state.conflicts.map((conflict) => {
      const resolving = busyAction === 'resolve' && state.busyId === conflict.recordId;
      const choice = (value: 'keep-current' | 'take-incoming', text: string, busyText: string) => h('button', {
        type: 'button', 'aria-busy': resolving || undefined, disabled: busy && !resolving ? true : undefined,
        onClick: busy ? undefined : () => void actions.resolve(conflict.recordId, value),
      }, ...(resolving ? [spinner(), busyText] : [text]));
      return h('li', { key: conflict.recordId, className: 'hqd-imports__row hqd-imports__row--conflict', 'data-kind': 'conflict' },
        h('span', { className: 'hqd-imports__row-main' },
          h('span', { className: 'hqd-imports__key' }, conflict.itemKey),
          h('span', { className: 'hqd-imports__note' }, conflict.label)),
        h('span', { className: 'hqd-imports__segmented', role: 'group', 'aria-label': `Resolve ${conflict.itemKey}` },
          choice('keep-current', 'Keep mine', 'Keeping'), choice('take-incoming', 'Take incoming', 'Taking')));
    })));

  const history = h('section', { className: 'hqd-imports__history', 'aria-labelledby': 'hqd-imports-history' },
    h('h3', { id: 'hqd-imports-history' }, 'History'),
    slot('history'),
    state.history.length === 0
      ? h('p', { className: 'hqd-imports__hint' }, 'No imports yet. Imports you apply appear here, with Undo.')
      : h('ol', { className: 'hqd-imports__timeline', ref: timeline }, state.history.map((entry) => {
        const undoing = busyAction === 'undo' && state.busyId === entry.importId;
        return h('li', { key: entry.importId, className: cx('hqd-imports__entry', flashId === entry.importId && 'hq-flash'), 'data-hq-motion-key': entry.importId, 'data-undone': entry.undone },
          h('span', { className: 'hqd-imports__dot', 'aria-hidden': true }),
          h('div', { className: 'hqd-imports__entry-body' },
            h('div', { className: 'hqd-imports__entry-head' },
              h('time', { dateTime: entry.importedAt, title: formatExactTime(entry.importedAt) }, formatRelativeTime(entry.importedAt, now)),
              entry.undone ? h(kit.StatusIndicator, { tone: 'neutral', label: 'Undone', live: false }) : null),
            h('p', { className: 'hqd-imports__entry-label' }, entry.undone ? h('s', null, entry.label) : entry.label),
            entry.undone ? null : actionButton({
              label: 'Undo', busyLabel: 'Undoing', busy: undoing, blocked: busy, variant: 'ghost', small: true,
              ariaLabel: `Undo import from ${entry.importedAt}`, onClick: () => void actions.undo(entry.importId),
            })));
      })));

  const lastExport = state.lastExport;
  const exportSection = h('fieldset', { className: 'hqd-imports__group hqd-imports__export' },
    h('legend', null, 'Backup and export'),
    h('div', { className: 'hqd-imports__choices' }, EXPORT_CHOICES.map((choice) => h('label', { key: choice.kind, className: 'hqd-imports__choice' },
      h('input', { type: 'radio', name: 'hqd-imports-export', value: choice.kind, checked: state.exportChoice === choice.kind, onChange: () => actions.setExportChoice(choice.kind) }),
      h('span', null, h('strong', null, choice.label), h('small', null, choice.description))))),
    h(kit.Presence, { show: draftChoice, motion: 'collapse', className: 'hqd-imports__confirm-slot' },
      h('label', { className: 'hqd-imports__confirm' },
        h('input', { type: 'checkbox', checked: state.confirmPrivate, onChange: (event: { target: { checked: boolean } }) => actions.setConfirmPrivate(event.target.checked) }),
        'I understand this file contains private drafts and will keep it private.')),
    h('div', { className: 'hqd-imports__export-actions' },
      h('button', { type: 'button', onClick: busyAction === 'export' ? undefined : actions.exportNow, disabled: draftChoice && !state.confirmPrivate, 'aria-busy': busyAction === 'export' || undefined },
        ...(busyAction === 'export' ? [spinner(), 'Preparing'] : [draftChoice ? 'Create private draft backup' : 'Create bundle']))),
    state.canSave ? null : h('p', { className: 'hqd-imports__unavailable' }, icon('skip'), 'Saving to disk is unavailable in this build.'),
    slot('export'),
    lastExport === null ? null : h('div', { className: 'hqd-imports__receipt hq-enter-rise' },
      h('div', { className: 'hqd-imports__receipt-head' },
        h('h4', null, 'Export receipt'),
        h(kit.StatusIndicator, { tone: lastExport.saved === true ? 'success' : 'neutral', live: false,
          label: lastExport.saved === true ? 'Saved' : lastExport.saved === false ? 'Not saved' : 'Prepared', detail: lastExport.saved === null ? 'in memory' : undefined }),
        h(CopyDigest, { digest: lastExport.digest, copy, toast })),
      h('dl', { className: 'hqd-imports__facts' },
        h('dt', null, 'Digest'), h('dd', null, h('code', null, lastExport.digest)),
        h('dt', null, 'Size'), h('dd', null, formatBytes(lastExport.bytes)),
        h('dt', null, 'Included'), h('dd', null, lastExport.coverage.included.length === 0 ? 'Nothing'
          : h('ul', { className: 'hqd-imports__chips' }, lastExport.coverage.included.map((item) => h('li', { key: item.namespace }, `${item.namespace} (${item.documents} records, ${item.blobs} files)`)))),
        h('dt', null, 'Left out'), h('dd', null, lastExport.coverage.omitted.length === 0 ? 'Nothing'
          : h('ul', { className: 'hqd-imports__chips' }, lastExport.coverage.omitted.map((item) => h('li', { key: item.namespace }, `${item.namespace}: ${item.reason.replaceAll('-', ' ')}`)))))));

  return h('section', { ref: root, className: 'hqd-imports', 'aria-labelledby': 'hqd-imports-title', 'aria-busy': busy },
    h('header', { className: 'hqd-imports__header' },
      h('h2', { id: 'hqd-imports-title' }, 'Import and export'),
      h('p', null, 'Bring in design files you have the rights to use. Re-importing never overwrites your edits.'),
      crossLink === undefined ? null : h('p', { className: 'hqd-imports__crosslink' }, `${crossLink.lead} `,
        h('button', { type: 'button', className: 'hqd-imports__link', onClick: crossLink.onOpen }, crossLink.label))),
    h('div', { className: 'hqd-imports__layout' },
      h('div', { className: 'hqd-imports__flow' },
        h(Stepper, { step }),
        h('div', { className: 'hqd-imports__stage' }, choosePanel, reviewPanel, donePanel),
        conflicts),
      history,
      exportSection));
}

// ---------------------------------------------------------------------------
// Container
// ---------------------------------------------------------------------------

/** Pass referentially stable `deps`/`capabilities`/`options`; a new object recreates the controller. */
export interface ImportsPanelProps {
  readonly deps: ImportDeps;
  readonly projectId: ProjectId;
  readonly capabilities?: ImportsCapabilities;
  readonly options?: ImportsControllerOptions;
  /** The F1 primitives from `@hq/ui`. Without them the surface renders with no motion and no toasts. */
  readonly kit?: ImportsKit;
  readonly crossLink?: ImportsCrossLink;
}

const MINUTE_MS = 60_000;

/** Wall clock that ticks each minute while something on screen shows a relative time. */
function useClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), MINUTE_MS);
    return () => clearInterval(interval);
  }, [active]);
  return now;
}

/** Container: binds the controller to the view. Root injects deps/capabilities. */
export function ImportsPanel({ deps, projectId, capabilities, options, kit = PLAIN_KIT, crossLink }: ImportsPanelProps): ReactElement {
  const controller = useMemo(() => createImportsController(deps, projectId, capabilities, options), [deps, projectId, capabilities, options]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  const toast = kit.useToast();
  const now = useClock(state.history.length > 0 || state.applied !== null);
  useEffect(() => { void controller.refresh(); }, [controller]);
  useEffect(() => controller.onOutcome((outcome) => announceOutcome(outcome, toast, controller)), [controller, toast]);
  const actions = useMemo<ImportsActions>(() => ({
    choose: () => void controller.choose(),
    apply: () => void controller.apply(),
    undo: controller.undo,
    resolve: controller.resolve,
    setExportChoice: controller.setExportChoice,
    setConfirmPrivate: controller.setConfirmPrivate,
    exportNow: () => void controller.exportNow(),
    reset: controller.reset,
    check: () => void controller.check(),
    dismiss: controller.dismissOutcome,
  }), [controller]);
  return h(ImportsView, { state, actions, kit, now, ...(crossLink === undefined ? {} : { crossLink }) });
}
