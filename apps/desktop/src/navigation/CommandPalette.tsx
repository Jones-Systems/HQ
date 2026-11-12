import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { InlineNotice, Presence } from '@hq/ui';
import type { Appearance, DomainId, ReferencePort } from '@hq/contracts';
import { buildCommands, OPEN_PALETTE_EVENT, runAction, SHOW_WELCOME_EVENT, type PaletteEffects, type SettingsTarget } from './commands';
import { describeLocation } from './destinations';
import { chordKeys, currentPlatformIsMac, PALETTE_CHORD } from './platform';
import { buildGroups, flattenRows, SEARCH_MIN_LENGTH, useReferenceSearch, type PaletteRow } from './search';
import { modalDialogOpen, resolveShellShortcut } from './shortcuts';
import './navigation.css';

export interface CommandPaletteProps {
  /** The domain on screen, and the remembered destination of each domain. */
  readonly domain: DomainId;
  readonly destinations: Readonly<Record<DomainId, string>>;
  readonly settingsOpen: boolean;
  readonly projectId: string;
  readonly appearance: Appearance;
  /** The shell's reference port. Without it the palette offers commands only. */
  readonly references?: Pick<ReferencePort, 'find' | 'open'>;
  /** Present while a reference return frame is active. Adds a "Back to …" command. */
  readonly returnFrame?: { readonly label: string; readonly onBack: () => void } | null;
  /** Go to a domain, optionally to a destination inside it. Same effect as the rail button plus a destination. */
  readonly onNavigate: (domain: DomainId, destination?: string) => void;
  readonly onOpenSettings: (target: SettingsTarget) => void;
  readonly onAppearance: (value: Appearance) => void;
  /** Override platform detection (⌘ versus Ctrl). */
  readonly mac?: boolean;
}

const PAGE_SIZE = 6;

/** After a command runs, keep a keyboard user in the page: if focus was lost with the old view, move it to the workspace. */
let settleTimer: number | undefined;
function settleFocus(): void {
  const check = () => {
    if (typeof document === 'undefined') return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const main = document.querySelector<HTMLElement>('main, [role="main"]');
    if (!main) return;
    if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
    main.focus({ preventScroll: true });
  };
  window.clearTimeout(settleTimer);
  window.requestAnimationFrame(check);
  settleTimer = window.setTimeout(check, 400);
}

/**
 * The HQ-wide command palette: Ctrl/⌘K in every domain and in Settings, or the `hq-open-command-palette` window event.
 * It does not open when a module already handled the key or another modal dialog is open. Everything it knows and does
 * arrives through props, so the shell stays the only owner of navigation state.
 */
export function CommandPalette(props: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const mac = useMemo(() => props.mac ?? currentPlatformIsMac(), [props.mac]);
  const openRef = useRef(false);
  const opener = useRef<HTMLElement | null>(null);

  const show = useCallback(() => {
    if (openRef.current) return;
    opener.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    openRef.current = true;
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    if (!openRef.current) return;
    openRef.current = false;
    setOpen(false);
    const element = opener.current;
    opener.current = null;
    if (element?.isConnected) element.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (openRef.current) return;
      if (resolveShellShortcut(event, { mac, modalOpen: modalDialogOpen() })?.type !== 'palette') return;
      event.preventDefault();
      show();
    };
    const onRequest = () => { if (!modalDialogOpen()) show(); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener(OPEN_PALETTE_EVENT, onRequest);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener(OPEN_PALETTE_EVENT, onRequest); };
  }, [mac, show]);

  return <Presence show={open} motion="fade" className="hq-palette-layer"
    onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <PaletteSurface {...props} mac={mac} open={open} isOpen={() => openRef.current} onClose={close} />
  </Presence>;
}

interface SurfaceProps extends CommandPaletteProps {
  readonly mac: boolean;
  readonly open: boolean;
  readonly isOpen: () => boolean;
  readonly onClose: () => void;
}

function PaletteSurface({ domain, destinations, settingsOpen, projectId, appearance, references, returnFrame, onNavigate, onOpenSettings, onAppearance, mac, open, isOpen, onClose }: SurfaceProps) {
  const uid = useId();
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const search = useReferenceSearch(references, projectId, query, open);
  const text = query.trim();

  const commands = useMemo(
    () => buildCommands({ domain, settingsOpen, appearance, back: returnFrame ? { label: returnFrame.label } : null, mac }),
    [domain, settingsOpen, appearance, returnFrame?.label, mac],
  );
  const groups = useMemo(() => buildGroups({ query, commands, results: search.results, currentDomain: domain }), [query, commands, search.results, domain]);
  const rows = useMemo(() => flattenRows(groups), [groups]);
  const activeIndex = Math.max(0, rows.findIndex(row => row.id === activeId));
  const active: PaletteRow | undefined = rows[activeIndex];
  const optionId = (index: number) => `${uid}-option-${index}`;

  useEffect(() => { if (open) input.current?.focus({ preventScroll: true }); }, [open]);
  // Focus that escapes the dialog (a click on the page behind it, a script) is pulled back while the palette is open.
  useEffect(() => {
    const keepFocus = (event: FocusEvent) => {
      if (isOpen() && event.target instanceof Node && !panel.current?.contains(event.target)) input.current?.focus({ preventScroll: true });
    };
    document.addEventListener('focusin', keepFocus);
    return () => document.removeEventListener('focusin', keepFocus);
  }, [isOpen]);
  useEffect(() => {
    if (!active) return;
    if (activeIndex === 0 && list.current) list.current.scrollTop = 0;
    document.getElementById(optionId(activeIndex))?.scrollIntoView?.({ block: 'nearest' });
  }, [active?.id, activeIndex]);

  const effects: PaletteEffects = {
    navigate: onNavigate,
    openSettings: onOpenSettings,
    setAppearance: onAppearance,
    showWelcome: () => { window.dispatchEvent(new CustomEvent(SHOW_WELCOME_EVENT)); },
    back: () => { returnFrame?.onBack(); },
    openReference: envelope => {
      const destination = destinations[domain];
      references?.open(envelope, { label: describeLocation(domain, destination), to: { domain, destination } });
    },
  };
  // Close first so focus is back on the opener (and the shell records it as Settings' return target) before the action runs.
  const run = (row: PaletteRow) => { onClose(); runAction(row.action, effects); settleFocus(); };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
    if (event.key === 'Tab') { event.preventDefault(); return; } // The input is the only tab stop; focus stays in the dialog.
    const resolved = resolveShellShortcut(event.nativeEvent, { mac, modalOpen: false });
    if (resolved?.type === 'palette') { event.preventDefault(); onClose(); return; }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const count = rows.length;
    const move = (index: number) => { event.preventDefault(); if (count > 0) setActiveId(rows[index]!.id); };
    switch (event.key) {
      case 'ArrowDown': move((activeIndex + 1) % Math.max(count, 1)); break;
      case 'ArrowUp': move((activeIndex - 1 + count) % Math.max(count, 1)); break;
      case 'PageDown': move(Math.min(count - 1, activeIndex + PAGE_SIZE)); break;
      case 'PageUp': move(Math.max(0, activeIndex - PAGE_SIZE)); break;
      case 'Home': if (!event.shiftKey) move(0); break;
      case 'End': if (!event.shiftKey) move(count - 1); break;
      case 'Enter': event.preventDefault(); if (active) run(active); break;
    }
  };

  const found = rows.filter(row => row.id !== 'search:wiki').length;
  const searching = search.status === 'pending';
  const settled = !searching;
  const empty = text.length > 0 && found === 0 && (text.length < SEARCH_MIN_LENGTH || search.status === 'done');
  const summary = settled ? `${found} ${found === 1 ? 'result' : 'results'}` : '';

  let index = -1;
  return <div ref={panel} className="hq-palette hq-enter-scale" role="dialog" aria-modal={open ? 'true' : undefined} aria-label="Command palette" onKeyDown={onKeyDown}>
    <input ref={input} className="hq-palette-input" role="combobox" aria-expanded="true" aria-haspopup="listbox" aria-autocomplete="list"
      aria-controls={`${uid}-list`} aria-activedescendant={active ? optionId(activeIndex) : undefined} aria-label="Search HQ or run a command"
      placeholder="Search HQ or run a command…" value={query} spellCheck={false} autoComplete="off"
      onChange={event => { setQuery(event.target.value); setActiveId(null); }} />
    {/* Keep the focus in the input when a row is pressed; the click handler still runs. */}
    <div ref={list} id={`${uid}-list`} className="hq-palette-list" role="listbox" aria-label="Commands and results" onMouseDown={event => event.preventDefault()}>
      {groups.map(group => {
        const labelId = `${uid}-group-${group.id}`;
        return <div key={group.id} role="group" aria-labelledby={labelId} className="hq-palette-group">
          <div id={labelId} className="hq-palette-group-label">{group.label}</div>
          {group.rows.map(row => {
            index++;
            const at = index;
            return <div key={row.id} id={optionId(at)} role="option" aria-selected={at === activeIndex} className="hq-palette-option"
              onMouseMove={() => { if (row.id !== active?.id) setActiveId(row.id); }} onClick={() => run(row)}>
              <span className="hq-palette-title">{row.title}</span>
              {row.detail && <span className="hq-palette-detail">{row.detail}</span>}
              {row.shortcut && <span className="hq-palette-keys">{chordKeys(row.shortcut, mac).map(key => <kbd key={key}>{key}</kbd>)}</span>}
            </div>;
          })}
        </div>;
      })}
    </div>
    {search.status === 'failed' && <InlineNotice tone="warning" variant="bar" live="polite" title="Search is unavailable">Commands still work. Try again in a moment.</InlineNotice>}
    <div className="hq-palette-status" aria-hidden="true">
      {searching ? <span className="hq-palette-searching">Searching…</span>
        : empty ? <span>No results for “{text}”</span>
        : <><span className="hq-palette-hints"><kbd>↑</kbd><kbd>↓</kbd> move <kbd>↵</kbd> open <kbd>Esc</kbd> close</span><span className="hq-palette-hint-chord">{chordKeys(PALETTE_CHORD, mac).map(key => <kbd key={key}>{key}</kbd>)}</span></>}
    </div>
    <div className="hq-sr-only" role="status">{summary}</div>
  </div>;
}
