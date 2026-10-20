import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { ModulePort } from '@hq/contracts';
import { DESIGN_NAV_IDS, type DesignLocation, type ShellContextPort } from '../../contract.ts';
import type { DesignCore } from '../domain-core.ts';
import { navTarget, regionStop, resolveShortcut, rovingNext, SHORTCUT_HINTS, tabStops, type ChromeView } from '../focus.ts';
import { formatDestination, NAV_LABELS, parseDestination, sameLocation } from '../navigation.ts';
import { buildCommands, CLOSED_PALETTE, paletteReduce, type PaletteAction, type ProjectCandidate } from '../palette.ts';
import { maxSize, resolveLayout, setPanelSize, splitterKey, togglePanel, type PanelId } from '../panels.ts';
import { cancelSwitch, confirmSwitch, INITIAL_GUARD, proposeSwitch, type GuardState } from '../project-guard.ts';
import type { DesignRegistry } from '../registry.ts';
import { chromeTheme } from '../theme.ts';
import { CommandPalette } from './CommandPalette.tsx';
import { ProjectSwitchPrompt } from './ProjectSwitchPrompt.tsx';
import { SectionOutlet, type SectionView } from './SectionOutlet.tsx';
import './design-ui.css';

export interface DesignChromeProps {
  readonly port: ModulePort;
  readonly shell: ShellContextPort;
  readonly core: DesignCore;
  readonly registry: DesignRegistry<SectionView>;
  readonly projects?: readonly ProjectCandidate[];
  readonly mac: boolean;
  readonly useKitTheme?: boolean;
}

const FLUSH_DELAY_MS = 750;
/** Run after React commits the current update (focus targets may be new). */
const afterCommit = (task: () => void) => { setTimeout(task, 0); };
const FALLBACK_WIDTH = 1280;

function isEditable(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}

type GuardEvent =
  | { readonly type: 'propose'; readonly current: string; readonly projectId: string; readonly label: string; readonly origin: 'palette' | 'reference' | 'section' }
  | { readonly type: 'cancel' }
  | { readonly type: 'confirmed'; readonly next: GuardState };

function guardReduce(state: GuardState, event: GuardEvent): GuardState {
  if (event.type === 'propose') return proposeSwitch(state, event.current, event.projectId, event.label, event.origin);
  if (event.type === 'cancel') return cancelSwitch(state);
  return event.next;
}

export function DesignChrome({ port, shell, core, registry, projects, mac, useKitTheme = false }: DesignChromeProps) {
  const snapshot = useSyncExternalStore(shell.subscribe, shell.getSnapshot, shell.getSnapshot);
  const projectId = snapshot.context.id;
  useSyncExternalStore(core.sessions.subscribe, core.sessions.version, core.sessions.version);
  const session = core.sessions.get(projectId);
  const persistence = core.sessions.persistence(projectId);
  const theme = chromeTheme(snapshot.appearance, useKitTheme ? undefined : snapshot.tokens);

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setWidth(Math.round(entry.contentRect.width)); });
    observer.observe(body);
    return () => observer.disconnect();
  }, []);

  // Keep-alive: chrome state lives in the core, not this tree. Flush shortly after
  // changes, on page hide and on unmount (the shell switching domain). Never submits.
  useEffect(() => {
    const timer = setTimeout(() => core.sessions.flush(), FLUSH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [core, session]);
  useEffect(() => {
    const flush = () => core.sessions.flush();
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); flush(); };
  }, [core]);

  const resolved = resolveLayout(session.panels, width);
  const visible = { sidebar: resolved.sidebar > 0, inspector: resolved.inspector > 0 };
  const sectionsByNav = registry.byNav;
  const requested = parseDestination(port.destination);
  const location: DesignLocation = requested.section !== null && registry.get(requested.section)?.nav === requested.nav
    ? requested : navTarget({ location: requested, sectionsByNav, visible, lastSection: session.lastSection }, requested.nav);
  const view: ChromeView = { location, sectionsByNav, visible, squeezed: resolved.squeezed, lastSection: session.lastSection };
  const stops = tabStops(view);
  const activeSection = location.section === null ? undefined : registry.get(location.section);

  const stopRefs = useRef(new Map<string, HTMLElement>());
  const stopProps = (id: string) => ({
    'data-hqd-stop': id,
    ref: (element: HTMLElement | null) => { if (element) stopRefs.current.set(id, element); else stopRefs.current.delete(id); },
  });
  const focusStop = (id: string | null) => { if (id !== null) stopRefs.current.get(id)?.focus(); };
  const focusedStop = (): string | null => {
    const active = typeof document === 'undefined' ? null : document.activeElement;
    return active instanceof HTMLElement ? active.closest<HTMLElement>('[data-hqd-stop]')?.dataset.hqdStop ?? null : null;
  };

  const go = (target: DesignLocation) => {
    if (target.section !== null) core.sessions.setLastSection(projectId, target.nav, target.section);
    if (!sameLocation(target, requested)) port.navigate(formatDestination(target));
  };
  const setPanels = (next: typeof session.panels) => {
    for (const panel of ['sidebar', 'inspector'] as const) {
      if (next[panel].collapsed && !session.panels[panel].collapsed
        && document.getElementById(`hqd-${panel}`)?.contains(document.activeElement)) {
        afterCommit(() => focusStop(`splitter:${panel}`));
      }
    }
    core.sessions.setPanels(projectId, next);
  };
  // A panel hidden only because the window is narrow cannot be shown; its toggle explains why.
  const toggle = (panel: PanelId) => { if (!resolved.squeezed.includes(panel)) setPanels(togglePanel(session.panels, panel)); };

  const [palette, paletteDispatch] = useReducer(paletteReduce, CLOSED_PALETTE);
  const [guard, guardDispatch] = useReducer(guardReduce, INITIAL_GUARD);
  const commandBus = useRef(new Map<string, { listeners: Set<(id: string) => void>; queued: string[] }>());
  const busFor = (sectionId: string) => {
    let bus = commandBus.current.get(sectionId);
    if (!bus) { bus = { listeners: new Set(), queued: [] }; commandBus.current.set(sectionId, bus); }
    return bus;
  };
  const onCommand = useCallback((sectionId: string, listener: (id: string) => void) => {
    const bus = busFor(sectionId);
    bus.listeners.add(listener);
    for (const queued of bus.queued.splice(0)) listener(queued);
    return () => { bus.listeners.delete(listener); };
  }, []);
  const propose = useCallback((target: string, label: string, origin: 'palette' | 'section') => {
    guardDispatch({ type: 'propose', current: projectId, projectId: target, label, origin });
  }, [projectId]);

  const openPalette = () => paletteDispatch({ type: 'open', returnFocus: focusedStop() });
  const closePalette = () => {
    const returnFocus = palette.returnFocus;
    paletteDispatch({ type: 'close' });
    afterCommit(() => focusStop(returnFocus ?? 'workspace'));
  };
  const runAction = (action: PaletteAction) => {
    paletteDispatch({ type: 'close' });
    switch (action.type) {
      case 'navigate': go(action.location); afterCommit(() => focusStop('workspace')); break;
      case 'toggle-panel': {
        const returnFocus = palette.returnFocus;
        toggle(action.panel);
        afterCommit(() => focusStop(returnFocus ?? 'workspace'));
        break;
      }
      case 'section-command': {
        go(action.location);
        const bus = busFor(action.location.section ?? '');
        if (bus.listeners.size === 0) bus.queued.push(action.commandId);
        else for (const listener of [...bus.listeners]) listener(action.commandId);
        afterCommit(() => focusStop('workspace'));
        break;
      }
      case 'propose-project': propose(action.projectId, action.label, 'palette'); break; // the prompt takes focus
    }
  };
  const commands = palette.open ? buildCommands({
    ...view, currentProjectId: projectId, ...(projects ? { projects } : {}),
    sections: registry.sections.map((section) => ({ id: section.id, title: section.title, nav: section.nav, commands: section.commands })),
  }) : [];

  const confirmProject = (token: number) => {
    const result = confirmSwitch(guard, token);
    guardDispatch({ type: 'confirmed', next: result.state });
    if (result.request !== null && shell.requestProjectContext) shell.requestProjectContext(result.request);
    afterCommit(() => focusStop('workspace'));
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || palette.open || guard.pending !== null) return; // modal surfaces handle their own keys
    const shortcut = resolveShortcut({
      key: event.key, code: event.code, metaKey: event.metaKey, ctrlKey: event.ctrlKey,
      altKey: event.altKey, shiftKey: event.shiftKey, editable: isEditable(event.target),
    }, mac);
    if (shortcut === null || shortcut.type === 'dismiss') return; // nothing open to dismiss
    event.preventDefault();
    switch (shortcut.type) {
      case 'palette': openPalette(); break;
      case 'region': focusStop(regionStop(stops, focusedStop(), shortcut.backwards)?.id ?? null); break;
      case 'nav': go(navTarget(view, shortcut.nav)); afterCommit(() => focusStop(`nav:${shortcut.nav}`)); break;
      case 'toggle-panel': toggle(shortcut.panel); break;
    }
  };
  // Shortcuts apply when focus is inside Design or nowhere in particular (body);
  // shell controls such as the domain rail keep their own keys.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const keyHandler = useRef(onKeyDown);
  useEffect(() => { keyHandler.current = onKeyDown; });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const root = rootRef.current;
      const target = event.target;
      if (!root) return;
      if ((target instanceof Node && root.contains(target)) || target === document.body || target === document.documentElement) keyHandler.current(event);
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, []);

  const roving = (event: ReactKeyboardEvent, ids: readonly string[], orientation: 'horizontal' | 'vertical') => {
    const current = focusedStop();
    const next = current === null ? null : rovingNext(ids, current, event.key, orientation);
    if (next !== null) { event.preventDefault(); focusStop(next); }
  };

  const barStops = stops.filter((stop) => stop.region === 'bar');
  const navStops = barStops.filter((stop) => stop.id.startsWith('nav:'));
  const sectionStops = stops.filter((stop) => stop.id.startsWith('section:'));

  const splitter = (panel: PanelId) => {
    const size = resolved[panel];
    const max = maxSize(session.panels, panel, width);
    return <div key={`splitter:${panel}`} {...stopProps(`splitter:${panel}`)}
      className={`hqd-splitter hqd-splitter-${panel}${size === 0 ? ' is-collapsed' : ''}`} role="separator" tabIndex={0}
      aria-orientation="vertical" aria-label={`Resize ${panel}`} aria-controls={`hqd-${panel}`}
      aria-valuemin={0} aria-valuemax={max} aria-valuenow={size}
      aria-valuetext={size === 0 ? `Collapsed; press Enter to restore ${panel}` : `${size} pixels; Home collapses, Enter toggles`}
      title={`Drag to resize ${panel}; click a closed edge or press Enter to restore`}
      onKeyDown={(event) => {
        const next = splitterKey(session.panels, panel, event.key, event.shiftKey, width);
        if (next) { event.preventDefault(); setPanels(next); }
      }}
      onPointerDown={(event) => {
        const target = event.currentTarget;
        event.preventDefault();
        target.focus();
        target.setPointerCapture(event.pointerId);
        const startX = event.clientX;
        const startLayout = session.panels;
        const direction = panel === 'sidebar' ? 1 : -1;
        let distance = 0;
        const startSize = startLayout[panel].collapsed ? 0 : size;
        const move = (moveEvent: PointerEvent) => {
          distance = moveEvent.clientX - startX;
          setPanels(setPanelSize(startLayout, panel, startSize + distance * direction, width));
        };
        const end = (endEvent: PointerEvent) => {
          if (endEvent.type === 'pointerup' && startLayout[panel].collapsed && Math.abs(distance) < 4) setPanels(togglePanel(startLayout, panel));
          target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', end); target.removeEventListener('pointercancel', end);
          target.removeEventListener('lostpointercapture', end);
        };
        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', end);
        target.addEventListener('pointercancel', end);
        target.addEventListener('lostpointercapture', end);
      }} />;
  };

  const style = { ...theme.vars, colorScheme: snapshot.appearance } as CSSProperties;
  return <div className="hqd-chrome" data-hqd-chrome="" data-appearance={snapshot.appearance} style={style} ref={rootRef}>
    <header className="hqd-bar">
      <nav className="hqd-subnav" aria-label="Design" onKeyDown={(event) => roving(event, navStops.map((stop) => stop.id), 'horizontal')}>
        {navStops.map((stop, index) => {
          const nav = DESIGN_NAV_IDS[index]!;
          return <button key={stop.id} type="button" {...stopProps(stop.id)} className="hqd-nav-item"
            aria-current={location.nav === nav ? 'page' : undefined} aria-keyshortcuts={`Alt+${index + 1}`}
            onClick={() => { if (stop.action.type === 'navigate') go(stop.action.location); }}>{stop.label}</button>;
        })}
      </nav>
      <div className="hqd-bar-tools">
        <button type="button" {...stopProps('palette')} className="hqd-palette-button"
          aria-haspopup="dialog" aria-keyshortcuts={mac ? 'Meta+K' : 'Control+K'} onClick={openPalette}>
          <span>Commands</span><kbd>{mac ? '⌘K' : 'Ctrl K'}</kbd>
        </button>
        {(['sidebar', 'inspector'] as const).map((panel) => <button key={panel} type="button"
          {...stopProps(`toggle:${panel}`)} className="hqd-icon-button"
          aria-pressed={visible[panel]} aria-controls={`hqd-${panel}`} aria-label={panel === 'sidebar' ? 'Sidebar' : 'Inspector'}
          aria-disabled={resolved.squeezed.includes(panel) || undefined}
          title={resolved.squeezed.includes(panel) ? `The window is too narrow for the ${panel}` : `${visible[panel] ? 'Hide' : 'Show'} ${panel}`}
          onClick={() => toggle(panel)}>
          <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4">
            <rect x="2.5" y="3.5" width="15" height="13" rx="2" />
            {panel === 'sidebar' ? <path d="M7.5 3.5v13" /> : <path d="M12.5 3.5v13" />}
          </svg>
        </button>)}
      </div>
    </header>
    <div className="hqd-body" ref={bodyRef}>
      {visible.sidebar &&
        <aside id="hqd-sidebar" className="hqd-sidebar" style={{ width: resolved.sidebar }} aria-label={`${NAV_LABELS[location.nav]} sections`}>
          <h2 className="hqd-heading">{NAV_LABELS[location.nav]}</h2>
          {sectionStops.length === 0
            ? <p className="hqd-empty">{`No ${NAV_LABELS[location.nav]} sections are installed yet.`}</p>
            : <nav className="hqd-section-list" aria-label={`${NAV_LABELS[location.nav]} sections`}
              onKeyDown={(event) => roving(event, sectionStops.map((stop) => stop.id), 'vertical')}>
              {sectionStops.map((stop) => <button key={stop.id} type="button" {...stopProps(stop.id)} className="hqd-section-item"
                aria-current={stop.action.type === 'navigate' && stop.action.location.section === location.section ? 'page' : undefined}
                onClick={() => { if (stop.action.type === 'navigate') go(stop.action.location); }}>{stop.label}</button>)}
            </nav>}
        </aside>}
      {!resolved.squeezed.includes('sidebar') && splitter('sidebar')}
      <section {...stopProps('workspace')} className="hqd-workspace" tabIndex={0}
        aria-label={activeSection ? activeSection.title : `${NAV_LABELS[location.nav]} workspace`} style={{ minWidth: 0 }}>
        {activeSection
          ? <SectionOutlet key={`${projectId}:${activeSection.id}`} section={activeSection} context={snapshot.context}
            appearance={snapshot.appearance} state={core.sessions.sectionHandle(projectId, activeSection.id)}
            navigate={go} propose={propose} onCommand={onCommand} />
          : <div className="hqd-placeholder">
            <h2>{NAV_LABELS[location.nav]}</h2>
            <p>No sections are available in this area yet.</p>
          </div>}
      </section>
      {!resolved.squeezed.includes('inspector') && splitter('inspector')}
      {visible.inspector &&
        <aside id="hqd-inspector" {...stopProps('inspector')} className="hqd-inspector"
          style={{ width: resolved.inspector }} tabIndex={0} aria-label="Inspector">
          <h2 className="hqd-heading">Inspector</h2>
          <dl className="hqd-facts">
            <dt>Location</dt><dd>{NAV_LABELS[location.nav]}{activeSection ? ` / ${activeSection.title}` : ''}</dd>
            <dt>Appearance</dt><dd>{snapshot.appearance === 'dark' ? 'Dark' : 'Light'} chrome; captures keep their own colours</dd>
            <dt>Chrome state</dt><dd>{persistence.status === 'ok' ? 'Saved locally' : persistence.status === 'held'
              ? <>Stored state is held ({persistence.reason}).{' '}
                <button type="button" className="hqd-link" onClick={() => core.sessions.startFresh(projectId)}>Start fresh</button></>
              : `In memory only (${persistence.reason})`}</dd>
          </dl>
          {registry.rejected.length > 0 && <div className="hqd-diagnostics" role="status">
            <h3>Sections not loaded</h3>
            <ul>{registry.rejected.map((item) => <li key={item.path}>{item.reason}</li>)}</ul>
          </div>}
          <h3 className="hqd-subheading">Keyboard</h3>
          <dl className="hqd-shortcuts">{SHORTCUT_HINTS.map((hint) => <div key={hint.keys}>
            <dt><kbd>{mac ? hint.keys.replaceAll('Mod', '⌘') : hint.keys.replaceAll('Mod', 'Ctrl')}</kbd></dt><dd>{hint.action}</dd>
          </div>)}</dl>
        </aside>}
    </div>
    {palette.open && <CommandPalette commands={commands} state={palette} dispatch={paletteDispatch} run={runAction} close={closePalette} />}
    {guard.pending !== null && <ProjectSwitchPrompt proposal={guard.pending} currentName={snapshot.context.name}
      available={shell.requestProjectContext !== null} confirm={confirmProject}
      cancel={() => { guardDispatch({ type: 'cancel' }); afterCommit(() => focusStop('workspace')); }} />}
  </div>;
}
