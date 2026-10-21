import { useEffect, useRef, useState } from 'react';
import { createReferencePort, type ReferenceNotice } from './references';
import { REFERENCE_PROVIDERS } from './reference-providers';
import type { ReturnContext } from '@hq/contracts/references';
import type { ShellState } from './state';
import { Splitter } from '@hq/ui';
import { deactivateDesktopPreview, overlayDesktopPreview, subscribeDesktopProject } from './interactive-runtime';
import { Connections } from './Connections';
import { ServiceSettings } from './ServiceSettings';
import { usePalette } from './appearance/usePalette';
import { DataSourcesProvider } from './settings/DataSources';
import type { DataSource } from './services/data-source-status';
import { DOMAIN_IDS, parseProjectContext, type Appearance, type DesktopPort } from '@hq/contracts';
import { DOMAIN_LABELS, MODULES, MODULE_PRESENTATION } from './modules';
import { APPEARANCE_KEY, RAIL_KEY, RAIL_MIN, RAIL_MAX, RAIL_COMPACT_MAX, readRail, resizeRail, toggleRail, cycleAppearance, navigate, navigationKey, persist, readAppearance, readNavigation, resolveAppearance, type StoragePort } from './state';

const CONTEXT = parseProjectContext({ id: 'hq-local', name: 'Local projects' })!;
const BROWSER_PORT: DesktopPort = Object.freeze({ platform: 'browser', versions: Object.freeze({ electron: null }) });
const unavailableStorage: StoragePort = { getItem: () => null, setItem: () => { throw new Error('Storage unavailable'); } };
function storagePort(): StoragePort { try { return window.localStorage; } catch { return unavailableStorage; } }

function WorkspaceApp() {
  const [storage] = useState(storagePort);
  const [context, setContext] = useState(CONTEXT);
  const contextRef = useRef(context); contextRef.current = context;
  const [projectMountId, setProjectMountId] = useState(CONTEXT.id);
  useEffect(() => subscribeDesktopProject((project, navigation) => {
    if (navigation !== 'preserve-design' || stateRef.current.domain !== 'design') {
      void deactivateDesktopPreview();
      setProjectMountId(project.id);
      setState(readNavigation(storage, project.id));
    }
    setContext(project); setReturnFrame(null); setReferenceNotice(null);
  }), [storage]);
  const [rail, setRail] = useState(() => readRail(storage));
  const compact = rail.width <= RAIL_COMPACT_MAX;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTarget, setSettingsTarget] = useState<DataSource | 'appearance' | null>(null);
  const settingsOpener = useRef<HTMLElement | null>(null);
  const wasSettingsOpen = useRef(false);
  const openSettings = (target: DataSource | 'appearance' | null, opener?: HTMLElement) => {
    settingsOpener.current = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setSettingsTarget(target); setSettingsOpen(true);
  };
  const closeSettings = () => setSettingsOpen(false);
  useEffect(() => { void overlayDesktopPreview(settingsOpen); }, [settingsOpen]);
  useEffect(() => {
    if (wasSettingsOpen.current && !settingsOpen) settingsOpener.current?.focus();
    wasSettingsOpen.current = settingsOpen;
  }, [settingsOpen]);
  useEffect(() => {
    const open = (event: Event) => {
      const target: unknown = (event as CustomEvent).detail?.source;
      openSettings(target === 'social' || target === 'work' || target === 'wiki' || target === 'appearance' ? target : null);
    };
    window.addEventListener('hq-open-settings', open);
    return () => window.removeEventListener('hq-open-settings', open);
  }, []);
  const [state, setState] = useState(() => readNavigation(storage, CONTEXT.id));
  const [appearance, setAppearance] = useState<Appearance>(() => readAppearance(storage));
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const theme = resolveAppearance(appearance, systemDark);
  const palette = usePalette(storage, theme === 'dark');
  const stateRef = useRef(state);
  stateRef.current = state;
  const Module = MODULES[state.domain];
  const [returnFrame, setReturnFrame] = useState<{ context: ReturnContext; state: ShellState } | null>(null);
  const [referenceNotice, setReferenceNotice] = useState<ReferenceNotice | null>(null);
  const [references] = useState(() => createReferencePort(REFERENCE_PROVIDERS, {
    projectId: () => contextRef.current.id,
    notice: setReferenceNotice,
    open(envelope, destination, context) {
      settingsOpener.current = null; setSettingsOpen(false);
      setReferenceNotice(null);
      setReturnFrame({ context, state: navigate(stateRef.current, context.to.domain, context.to.destination) });
      setState(previous => navigate(previous, envelope.domain, destination));
    },
  }));
  const goBack = () => {
    references.cancelOpen();
    if (returnFrame) setState(returnFrame.state);
    setReturnFrame(null); setReferenceNotice(null);
  };
  useEffect(() => { if (state.domain !== 'design') void deactivateDesktopPreview(); }, [state.domain]);
  const fill = MODULE_PRESENTATION[state.domain] === 'fill';

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    const navigationSaved = persist(storage, navigationKey(context.id), JSON.stringify(state));
    const appearanceSaved = persist(storage, APPEARANCE_KEY, appearance);
    const railSaved = persist(storage, RAIL_KEY, JSON.stringify(rail));
    setStorageAvailable(navigationSaved && appearanceSaved && railSaved);
  }, [storage, state, appearance, rail, context.id]);

  return <div className="shell" data-hq-chrome>
    <aside className={`rail${compact ? " is-compact" : ""}`} ref={element => { element?.style.setProperty("width", `${rail.width}px`); element?.style.setProperty("--rail-w", `${rail.width}px`); }} aria-label="HQ navigation">
      <div className="brand" aria-label="HQ">HQ<span className="brand-dot" /></div>
      <nav aria-label="Domains">{DOMAIN_IDS.map((domain) => <button key={domain}
        className="domain-button" title={DOMAIN_LABELS[domain]} aria-current={!settingsOpen && state.domain === domain ? 'page' : undefined}
        onClick={() => { settingsOpener.current = null; setSettingsOpen(false); references.cancelOpen(); setReturnFrame(null); setReferenceNotice(null); setState(previous => navigate(previous, domain)); }}>
        <svg className="domain-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          {domain === 'wiki' ? <><path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Z" /><path d="M12 5v15" /></> : domain === 'design' ? <path d="m12 3 9 9-9 9-9-9Z" /> : domain === 'social' ? <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /></> : <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 9h8M8 15h8" /></>}
        </svg>
        <span className="rail-label">{DOMAIN_LABELS[domain]}</span>
      </button>)}</nav>
      <div className="rail-footer">
        <Connections compact={compact} onManage={(source, opener) => openSettings(source ?? null, opener)} />
        <div className="rail-utilities">
        <button className="rail-action" title="Settings" aria-current={settingsOpen ? 'page' : undefined} onClick={event => openSettings(null, event.currentTarget)}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/></svg>
          <span className="rail-label">Settings</span>
        </button>
        <button className="rail-action" aria-label={`Appearance: ${appearance[0]!.toUpperCase() + appearance.slice(1)}`}
          title={`Appearance: ${appearance}. Switch to ${cycleAppearance(appearance)}`} onClick={() => setAppearance(cycleAppearance)}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            {appearance === 'system' ? <><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></> : appearance === 'dark' ? <path d="M20 14A9 9 0 0 1 10 4a9 9 0 1 0 10 10Z"/> : <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/></>}
          </svg><span className="rail-label">{appearance[0]!.toUpperCase() + appearance.slice(1)}</span>
        </button>
        </div>
      </div>
    </aside>
    <Splitter label="Primary navigation width" value={rail.width} min={RAIL_MIN} max={RAIL_MAX}
      onResize={width => setRail(previous => resizeRail(previous, width))} onToggle={() => setRail(toggleRail)} />
    <div className={fill ? 'workspace is-fill' : 'workspace'} data-hq-overlay={settingsOpen ? 'open' : undefined}>
      {returnFrame && <button hidden={settingsOpen} onClick={goBack}>Back to {returnFrame.context.label}</button>}
      {referenceNotice && <section hidden={settingsOpen} role="status" aria-label="Read-only reference"><strong>{referenceNotice.title}</strong><p>{referenceNotice.message}</p><button onClick={() => setReferenceNotice(null)}>Dismiss reference</button></section>}
      <main hidden={settingsOpen} className={fill ? 'is-fill' : undefined} key={`${projectMountId}:${state.domain}`}>
        <Module context={context} destination={state.destinations[state.domain]} appearance={theme} desktop={window.hqDesktop ?? BROWSER_PORT}
          references={references} {...(returnFrame ? { returnContext: returnFrame.context } : {})}
          navigate={destination => { references.cancelOpen(); setState(previous => navigate(previous, state.domain, destination)); }} />
      </main>
      {settingsOpen && <ServiceSettings config={window.hqServices?.config} onClose={closeSettings}
        returnLabel={DOMAIN_LABELS[state.domain]} target={settingsTarget} appearance={appearance} onAppearanceChange={setAppearance} palette={palette} dark={theme === 'dark'} />}
      <footer className="context-footer" aria-label="Workspace context"><span>{context.name}</span><span>{DOMAIN_LABELS[state.domain]}</span></footer>
      {!(storageAvailable && palette.saved) && <p className="storage-notice" role="status">Preferences are available for this session. Local storage is unavailable.</p>}
    </div>
  </div>;
}

export function App() { return <DataSourcesProvider><WorkspaceApp /></DataSourcesProvider>; }
