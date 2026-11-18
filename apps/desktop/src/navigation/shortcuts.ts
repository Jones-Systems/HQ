import { useEffect, useRef } from 'react';
import { DOMAIN_IDS, type DomainId } from '@hq/contracts';
import { currentPlatformIsMac } from './platform';

/** The slice of a keyboard event the shell shortcuts read. */
export interface KeyInput {
  readonly key: string;
  readonly code?: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly defaultPrevented: boolean;
  readonly isComposing?: boolean;
  readonly repeat?: boolean;
}

export interface ShortcutGuards {
  readonly mac: boolean;
  /** An `[aria-modal="true"]` dialog is open: it owns the keyboard. */
  readonly modalOpen: boolean;
  /** The event came from an input, textarea, select or contenteditable element. */
  readonly editable?: boolean;
  /** The Back pill is shown. */
  readonly backAvailable?: boolean;
}

export type ShellShortcut =
  | { readonly type: 'palette' }
  | { readonly type: 'domain'; readonly domain: DomainId }
  | { readonly type: 'settings' }
  | { readonly type: 'back' };

const letter = (event: KeyInput) => (event.key.length === 1 ? event.key.toLowerCase() : event.key);

/** Ctrl on Windows and Linux, ⌘ on macOS, with no other modifier. */
const bareMod = (event: KeyInput, mac: boolean) => (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) && !event.altKey && !event.shiftKey;

/** Digit 1–9 from the layout-independent code, falling back to the key for synthetic events. */
function digit(event: KeyInput): number | null {
  const fromCode = /^(?:Digit|Numpad)([1-9])$/u.exec(event.code ?? '');
  const value = fromCode ? fromCode[1] : /^[1-9]$/u.test(event.key) ? event.key : null;
  return value === null ? null : Number(value);
}

/**
 * Which shell shortcut, if any, an event is. Pure. A handled event, an open modal dialog or text composition always
 * yields none. Alt+digits belong to Design, so only the platform modifier is used for domains.
 */
export function resolveShellShortcut(event: KeyInput, guards: ShortcutGuards): ShellShortcut | null {
  if (event.defaultPrevented || guards.modalOpen || event.isComposing) return null;
  const { mac } = guards;
  if (bareMod(event, mac)) {
    if (letter(event) === 'k') return { type: 'palette' };
    if (event.key === ',') return { type: 'settings' };
    const index = digit(event);
    const domain = index === null ? undefined : DOMAIN_IDS[index - 1];
    if (domain) return { type: 'domain', domain };
    // ⌘[ on macOS. Never from a text field, where it indents.
    if (mac && event.key === '[' && guards.backAvailable && !guards.editable) return { type: 'back' };
    return null;
  }
  // Alt+← elsewhere. Alt+arrow in a field moves by word, so editable targets keep it.
  if (!mac && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.key === 'ArrowLeft'
    && guards.backAvailable && !guards.editable) return { type: 'back' };
  return null;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !== null;
}

/** True while any modal dialog (Design's palette, ours, a confirmation) is open. */
export function modalDialogOpen(root: ParentNode = document): boolean {
  return root.querySelector('[aria-modal="true"]') !== null;
}

export interface ShellShortcutHandlers {
  switchDomain(domain: DomainId): void;
  openSettings(): void;
}

/**
 * Global shell shortcuts: Ctrl/⌘+1–4 switch domain and Ctrl/⌘+, opens Settings. The palette and Back own their own
 * chords, so this resolves only those two kinds. Listens in the bubble phase so a focused module that handled the key
 * (and called preventDefault) wins.
 */
export function useShellShortcuts(handlers: ShellShortcutHandlers, options: { readonly mac?: boolean } = {}): void {
  const latest = useRef(handlers);
  latest.current = handlers;
  const override = options.mac;
  useEffect(() => {
    const mac = override ?? currentPlatformIsMac();
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = resolveShellShortcut(event, { mac, modalOpen: modalDialogOpen(), editable: isEditableTarget(event.target) });
      if (shortcut?.type === 'domain') { event.preventDefault(); latest.current.switchDomain(shortcut.domain); }
      else if (shortcut?.type === 'settings') { event.preventDefault(); latest.current.openSettings(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [override]);
}
