import { useEffect, useRef, useState } from 'react';
import { createReferencePort, type ReferenceNotice } from './references';
import { REFERENCE_PROVIDERS } from './reference-providers';
import type { ReturnContext } from '@hq/contracts/references';
import type { ShellState } from './state';
import { ServiceSettings } from './ServiceSettings';
import { APPEARANCES, DOMAIN_IDS, isAppearance, parseProjectContext, type Appearance, type DesktopPort } from '@hq/contracts';
import { DOMAIN_LABELS, MODULES, MODULE_PRESENTATION } from './modules';
import { APPEARANCE_KEY, navigate, navigationKey, persist, readAppearance, readNavigation, resolveAppearance, type StoragePort } from './state';

const CONTEXT = parseProjectContext({ id: 'hq-local', name: 'HQ workspace' })!;
const BROWSER_PORT: DesktopPort = Object.freeze({ platform: 'browser', versions: Object.freeze({ electron: null }) });
const unavailableStorage: StoragePort = { getItem: () => null, setItem: () => { throw new Error('Storage unavailable'); } };
function storagePort(): StoragePort { try { return window.localStorage; } catch { return unavailableStorage; } }

export function App() {
  const [storage] = useState(storagePort);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [state, setState] = useState(() => readNavigation(storage, CONTEXT.id));
  const [appearance, setAppearance] = useState<Appearance>(() => readAppearance(storage));
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const theme = resolveAppearance(appearance, systemDark);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [visited, setVisited] = useState(() => new Set([state.domain]));
  const [returnFrame, setReturnFrame] = useState<{ context: ReturnContext; state: ShellState } | null>(null);
  const [referenceNotice, setReferenceNotice] = useState<ReferenceNotice | null>(null);
  const [references] = useState(() => createReferencePort(REFERENCE_PROVIDERS, {
    projectId: () => CONTEXT.id,
    notice: setReferenceNotice,
    open(envelope, destination, context) {
      setReferenceNotice(null);
      setReturnFrame({ context, state: navigate(stateRef.current, context.to.domain, context.to.destination) });
      setVisited(previous => new Set([...previous, envelope.domain]));
      setState(previous => navigate(previous, envelope.domain, destination));
    },
  }));
  const goBack = () => {
    references.cancelOpen();
    if (returnFrame) setState(returnFrame.state);
    setReturnFrame(null); setReferenceNotice(null);
  };
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
    const navigationSaved = persist(storage, navigationKey(CONTEXT.id), JSON.stringify(state));
    const appearanceSaved = persist(storage, APPEARANCE_KEY, appearance);
    setStorageAvailable(navigationSaved && appearanceSaved);
  }, [storage, state, appearance]);

  return <div className="shell">
    <aside className="rail">
      <div className="brand" aria-label="HQ">HQ<span className="brand-dot" /></div>
      <nav aria-label="Domains">{DOMAIN_IDS.map((domain) => <button key={domain}
        className="domain-button" aria-current={state.domain === domain ? 'page' : undefined}
        onClick={() => { references.cancelOpen(); setReturnFrame(null); setReferenceNotice(null); setVisited(previous => new Set([...previous, domain])); setState(previous => navigate(previous, domain)); }}>
        <svg className="domain-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          {domain === 'design' ? <path d="m12 3 9 9-9 9-9-9Z" /> : domain === 'social' ? <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /></> : <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 9h8M8 15h8" /></>}
        </svg>
        {DOMAIN_LABELS[domain]}
      </button>)}</nav>
      <div className="rail-footer">{window.hqServices && <button onClick={() => setSettingsOpen(true)}>Service settings</button>}<label htmlFor="appearance">Appearance</label>
        <select id="appearance" value={appearance} onChange={(event) => {
          if (isAppearance(event.target.value)) setAppearance(event.target.value);
        }}>{APPEARANCES.map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</select>
      </div>
    </aside>
    <div className={fill ? 'workspace is-fill' : 'workspace'}>
      <header className="context-bar"><span>{DOMAIN_LABELS[state.domain]}</span><span className="project-context">Project <strong>{CONTEXT.name}</strong></span></header>
      {returnFrame && <button onClick={goBack}>Back to {returnFrame.context.label}</button>}
      {referenceNotice && <section role="status" aria-label="Read-only reference"><strong>{referenceNotice.title}</strong><p>{referenceNotice.message}</p><button onClick={() => setReferenceNotice(null)}>Dismiss reference</button></section>}
      {DOMAIN_IDS.filter(domain => visited.has(domain)).map(domain => {
        const Module = MODULES[domain];
        return <main hidden={domain !== state.domain} className={MODULE_PRESENTATION[domain] === 'fill' ? 'is-fill' : undefined} key={`${CONTEXT.id}:${domain}`}>
          <Module context={CONTEXT} destination={state.destinations[domain]} appearance={theme} desktop={window.hqDesktop ?? BROWSER_PORT}
            references={references} {...(returnFrame && domain === state.domain ? { returnContext: returnFrame.context } : {})}
            navigate={destination => setState(previous => navigate(previous, domain, destination))} />
        </main>;
      })}
      {!storageAvailable && <p className="storage-notice" role="status">Preferences are available for this session. Local storage is unavailable.</p>}
    </div>
    {settingsOpen && window.hqServices && <ServiceSettings config={window.hqServices.config} onClose={() => setSettingsOpen(false)} />}
  </div>;
}
