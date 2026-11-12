import {
  createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore,
  type KeyboardEvent, type ReactNode,
} from 'react';
import { Button, IconButton } from '../components/Button';
import { cx } from '../components/cx';
import { usePresence } from '../motion/Presence';
import { createToastApi, toastStore, type ToastApi, type ToastRecord, type ToastStore, type ToastTone } from './toast-store';

const ToastStoreContext = createContext<ToastStore>(toastStore);

/** Scopes `useToast` and `<ToastViewport>` to another store (tests, harnesses, an isolated window). */
export function ToastStoreProvider({ store, children }: { readonly store: ToastStore; readonly children?: ReactNode }) {
  return <ToastStoreContext.Provider value={store}>{children}</ToastStoreContext.Provider>;
}

/** The toast API bound to the nearest store (the app-wide one by default). */
export function useToast(): ToastApi {
  const store = useContext(ToastStoreContext);
  return useMemo(() => (store === toastStore ? defaultApi : createToastApi(store)), [store]);
}
const defaultApi = createToastApi(toastStore);

/** Current toasts, for custom renderers. */
export function useToasts(): readonly ToastRecord[] {
  const store = useContext(ToastStoreContext);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

const DISMISS_ICON = <svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17" /></svg>;
const GLYPHS: Partial<Record<ToastTone, ReactNode>> = {
  info: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8h.01" /></svg>,
  success: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12.5 2.3 2.3 4.7-5" /></svg>,
  warning: <svg viewBox="0 0 24 24"><path d="M12 4 21 19.5H3Z" /><path d="M12 10v4M12 17h.01" /></svg>,
  danger: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v5.5M12 16.5h.01" /></svg>,
  unknown: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" strokeDasharray="3 2.6" /><path d="M10 9.8a2.2 2.2 0 1 1 3 2c-.6.3-1 .8-1 1.4v.3M12 16.5h.01" /></svg>,
};

/**
 * Text for a live region. Identical consecutive text (a folded repeat) gets a trailing no-break space, because a
 * region only announces when its text changes.
 */
function nextAnnouncement(previous: string, texts: readonly string[]): string {
  const text = texts.join('. ');
  return text === previous ? `${text}\u00A0` : text;
}

export interface ToastViewportProps {
  /** Landmark name. Default "Notifications". */
  readonly label?: string;
  /** Key that moves focus into the newest toast, and back out again. Default F8 (`null` disables it). */
  readonly hotkey?: string | null;
  /** Toasts shown at once; older ones fold behind a "N more" control. Default 3. */
  readonly visible?: number;
  readonly className?: string;
}

/**
 * Renders the store's toasts in the bottom-end corner. Mount it once, outside any view that unmounts. New toasts
 * rise in, leaving ones slide out and the stack closes up. Screen readers hear each toast through dedicated live
 * regions (failures assertively); hover, focus or a hidden window pause every timer; Escape dismisses the focused
 * toast; F8 jumps to the newest toast and back.
 */
export function ToastViewport({ label = 'Notifications', hotkey = 'F8', visible = 3, className }: ToastViewportProps) {
  const store = useContext(ToastStoreContext);
  const records = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [expanded, setExpanded] = useState(false);
  const region = useRef<HTMLElement | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const paused = useRef({ pointer: false, focus: false, hidden: false });

  // Keep removed toasts rendered until their exit animation finishes.
  const known = useRef(new Map<string, ToastRecord>());
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  for (const record of records) known.current.set(record.id, record);
  const live = new Set(records.map((record) => record.id));
  const ordered = [...known.current.values()].sort((a, b) => a.createdAt - b.createdAt);
  const onExited = useCallback((id: string) => { known.current.delete(id); rerender(); }, []);

  const shownIds = new Set(records.slice(expanded ? 0 : Math.max(0, records.length - visible)).map((record) => record.id));
  const folded = records.length - shownIds.size;
  useEffect(() => { if (records.length <= visible) setExpanded(false); }, [records.length, visible]);

  // One shared pause for the whole stack: pointer over it, focus inside it, or the window hidden.
  const syncPause = useCallback((key: 'pointer' | 'focus' | 'hidden', value: boolean) => {
    const state = paused.current;
    const before = state.pointer || state.focus || state.hidden;
    state[key] = value;
    const after = state.pointer || state.focus || state.hidden;
    if (!before && after) store.pause();
    if (before && !after) store.resume();
  }, [store]);
  useEffect(() => {
    const onVisibility = () => syncPause('hidden', document.hidden);
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      const state = paused.current;
      if (state.pointer || state.focus || state.hidden) store.resume();
      paused.current = { pointer: false, focus: false, hidden: false };
    };
  }, [store, syncPause]);

  // Announcements: a toast's words, once per revision, through the polite or assertive region.
  const [polite, setPolite] = useState('');
  const [assertive, setAssertive] = useState('');
  const announced = useRef(new Map<string, number>());
  useEffect(() => {
    const politeTexts: string[] = [];
    const assertiveTexts: string[] = [];
    for (const record of records) {
      if (announced.current.get(record.id) === record.revision) continue;
      announced.current.set(record.id, record.revision);
      const text = [record.title, record.description].filter(Boolean).join('. ');
      (record.tone === 'danger' || record.tone === 'unknown' ? assertiveTexts : politeTexts).push(text);
    }
    for (const id of [...announced.current.keys()]) if (!live.has(id)) announced.current.delete(id);
    // Toasts raised together share one announcement, so a burst is not reduced to its last toast.
    if (politeTexts.length > 0) setPolite((previous) => nextAnnouncement(previous, politeTexts));
    if (assertiveTexts.length > 0) setAssertive((previous) => nextAnnouncement(previous, assertiveTexts));
  });

  /** Returns focus to where it was before F8; when that was the page itself (nothing focused), just leaves the toasts. */
  const leaveToasts = useCallback(() => {
    const back = returnFocus.current;
    returnFocus.current = null;
    if (back && back !== document.body && back.isConnected) { back.focus(); return; }
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }, []);

  useEffect(() => {
    if (!hotkey) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== hotkey || event.altKey || event.ctrlKey || event.metaKey) return;
      const root = region.current;
      if (!root) return;
      if (root.contains(document.activeElement)) {
        event.preventDefault();
        leaveToasts();
        return;
      }
      const target = root.querySelector<HTMLElement>('.hq-toast-slot:last-of-type button');
      if (!target) return;
      event.preventDefault();
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      target.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hotkey, leaveToasts]);

  const dismissFromKeyboard = (record: ToastRecord) => {
    const root = region.current;
    const slots = root ? [...root.querySelectorAll<HTMLElement>('.hq-toast-slot:not([data-hq-presence="exit"])')] : [];
    const index = slots.findIndex((slot) => slot.dataset.toastId === record.id);
    const neighbour = slots[index - 1] ?? slots[index + 1];
    store.dismiss(record.id, 'user');
    const next = neighbour?.querySelector<HTMLElement>('button');
    if (next) next.focus(); else leaveToasts();
  };

  return (
    <section ref={region} className={cx('hq-toast-viewport', className)} aria-label={hotkey ? `${label} (${hotkey})` : label}
      onPointerEnter={() => syncPause('pointer', true)} onPointerLeave={() => syncPause('pointer', false)}
      onFocus={() => syncPause('focus', true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) syncPause('focus', false); }}>
      {folded > 0 && (
        <button type="button" className="hq-toast-more" aria-expanded={false} onClick={() => setExpanded(true)}>
          {folded} more {folded === 1 ? 'notification' : 'notifications'}
        </button>
      )}
      <ol className="hq-toast-list">
        {ordered.filter((record) => !live.has(record.id) || shownIds.has(record.id)).map((record) => (
          <ToastItem key={record.id} record={record} leaving={!live.has(record.id)} onExited={onExited}
            onDismiss={() => store.dismiss(record.id, 'user')} onKeyboardDismiss={() => dismissFromKeyboard(record)}
            onAction={() => {
              record.action?.onAction();
              if (record.action?.dismiss !== false) store.dismiss(record.id, 'action');
            }} />
        ))}
      </ol>
      <div className="hq-sr-only" role="status" aria-live="polite" aria-atomic="true">{polite}</div>
      <div className="hq-sr-only" role="alert" aria-live="assertive" aria-atomic="true">{assertive}</div>
    </section>
  );
}

interface ToastItemProps {
  readonly record: ToastRecord;
  readonly leaving: boolean;
  readonly onExited: (id: string) => void;
  readonly onDismiss: () => void;
  readonly onKeyboardDismiss: () => void;
  readonly onAction: () => void;
}

function ToastItem({ record, leaving, onExited, onDismiss, onKeyboardDismiss, onAction }: ToastItemProps) {
  const presence = usePresence<HTMLLIElement>(!leaving, { motion: 'toast', onExited: () => onExited(record.id) });
  // A toast that is removed while folded behind "N more" is first rendered already leaving: it has no exit animation
  // to wait for, so drop it at once instead of leaving an inert ghost on screen.
  const startedLeaving = useRef(leaving);
  useEffect(() => { if (startedLeaving.current) onExited(record.id); }, [onExited, record.id]);
  if (!presence.mounted) return null;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && record.dismissible) { event.stopPropagation(); onKeyboardDismiss(); }
  };
  const glyph = record.tone === 'loading' ? <span className="hq-spinner" /> : GLYPHS[record.tone];
  return (
    <li ref={presence.ref} {...presence.props} className="hq-toast-slot" data-toast-id={record.id} inert={leaving || undefined}>
      <div className={cx('hq-toast', `hq-toast--${record.tone}`)} data-tone={record.tone} onKeyDown={onKeyDown}
        role="group" aria-label={record.title}>
        {glyph && <span className="hq-toast-glyph" aria-hidden="true">{glyph}</span>}
        <div className="hq-toast-text">
          <span className="hq-toast-title">
            {record.title}
            {record.repeat > 1 && <span className="hq-toast-repeat" aria-label={`${record.repeat} times`}>×{record.repeat}</span>}
          </span>
          {record.description && <span className="hq-toast-description">{record.description}</span>}
          {record.meta && <span className="hq-meta">{record.meta}</span>}
        </div>
        {record.action && (
          <Button size="sm" variant="secondary" onClick={onAction} aria-keyshortcuts={record.action.keyshortcuts}>{record.action.label}</Button>
        )}
        {record.dismissible && <IconButton size="sm" variant="ghost" label="Dismiss notification" onClick={onDismiss} icon={DISMISS_ICON} />}
      </div>
    </li>
  );
}
