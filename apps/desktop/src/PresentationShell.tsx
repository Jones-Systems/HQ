import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type MouseEvent } from 'react';
import { createReferencePort, type ReferenceNotice } from './references';
import type { ReferenceProvider, ReturnContext } from '@hq/contracts/references';
import type { ShellState } from './state';
import { ErrorBoundary, InlineNotice, PAGE_TRANSITION_CLASS, Splitter, ToastViewport, navigateWithTransition, toast } from '@hq/ui';
import { deactivateDesktopPreview, overlayDesktopPreview, selectDesktopProject, subscribeDesktopProject } from './interactive-runtime';
import { ServiceSettings } from './ServiceSettings';
import { usePalette } from './appearance/usePalette';
import { DataSourcesProvider } from './settings/DataSources';
import type { DataSource } from './services/data-source-status';
import { parseProjectContext, type Appearance, type DesktopPort, type DomainId, type ModulePort } from '@hq/contracts';
import { DOMAIN_LABELS, type ModulePresentation } from './domain-metadata';
import { APPEARANCE_KEY, RAIL_KEY, RAIL_MIN, RAIL_MAX, RAIL_COMPACT_MAX, readRail, resizeRail, toggleRail, navigate, navigationKey, persist, readAppearance, readNavigation, resolveAppearance, type StoragePort } from './state';
import { APPEARANCE_LABELS } from './shell/AppearanceControl';
import { Rail } from './shell/Rail';
import { TopBar } from './shell/TopBar';
import { useMediaQuery } from './shell/media';
import { RECENT_PROJECTS_KEY, readRecentProjects, rememberProject, type RecentProject } from './shell/recent-projects';
import './shell/shell.css';

const CONTEXT = parseProjectContext({ id: 'hq-local', name: 'Local projects' })!;
const BROWSER_PORT: DesktopPort = Object.freeze({ platform: 'browser', versions: Object.freeze({ electron: null }) });
const unavailableStorage: StoragePort = { getItem: () => null, setItem: () => { throw new Error('Storage unavailable'); } };
function storagePort(): StoragePort { try { return window.localStorage; } catch { return unavailableStorage; } }
/** Below this width the rail stays compact whatever its saved width, so content keeps the room. */
const NARROW_WINDOW = '(max-width: 999px)';

export interface PresentationShellProps {
  modules: Readonly<Record<DomainId, ComponentType<ModulePort>>>;
  presentation: ModulePresentation;
  referenceProviders: readonly ReferenceProvider[];
}

function WorkspaceApp({ modules, presentation, referenceProviders }: PresentationShellProps) {
  const [storage] = useState(storagePort);
  const [context, setContext] = useState(CONTEXT);
  const contextRef = useRef(context); contextRef.current = context;
  const [projectMountId, setProjectMountId] = useState(CONTEXT.id);
  const [recentProjects, setRecentProjects] = useState(() => readRecentProjects(storage));
  useEffect(() => subscribeDesktopProject((project, navigation) => {
    const remount = navigation !== 'preserve-design' || stateRef.current.domain !== 'design';
    if (remount) void deactivateDesktopPreview();
    setRecentProjects(previous => rememberProject(previous, project));
    navigateWithTransition(() => {
      if (remount) { setProjectMountId(project.id); setState(readNavigation(storage, project.id)); }
      setContext(project); setReturnFrame(null); setReferenceNotice(null);
    });
  }), [storage]);
  const [rail, setRail] = useState(() => readRail(storage));
  const narrow = useMediaQuery(NARROW_WINDOW);
  const railWidth = narrow ? RAIL_MIN : rail.width;
  const compact = railWidth <= RAIL_COMPACT_MAX;
  const shellRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { shellRef.current?.style.setProperty('--shell-rail-w', `${railWidth}px`); }, [railWidth]);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTarget, setSettingsTarget] = useState<DataSource | 'appearance' | null>(null);
  const settingsOpener = useRef<HTMLElement | null>(null);
  const wasSettingsOpen = useRef(false);
  const openSettings = (target: DataSource | 'appearance' | null, opener?: HTMLElement) => {
    settingsOpener.current = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    navigateWithTransition(() => { setSettingsTarget(target); setSettingsOpen(true); }, 'forward');
  };
  const closeSettings = () => navigateWithTransition(() => setSettingsOpen(false), 'back');
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
  const Module = modules[state.domain];
  const [returnFrame, setReturnFrame] = useState<{ context: ReturnContext; state: ShellState } | null>(null);
  const [referenceNotice, setReferenceNotice] = useState<ReferenceNotice | null>(null);
  const [references] = useState(() => createReferencePort(referenceProviders, {
    projectId: () => contextRef.current.id,
    notice: setReferenceNotice,
    open(envelope, destination, context) {
      settingsOpener.current = null;
      navigateWithTransition(() => {
        setSettingsOpen(false); setReferenceNotice(null);
        setReturnFrame({ context, state: navigate(stateRef.current, context.to.domain, context.to.destination) });
        setState(previous => navigate(previous, envelope.domain, destination));
      }, 'forward');
    },
  }));
  /** Explicit navigation to a domain (and destination): leaves Settings and any reference trail. */
  const go = (domain: DomainId, destination?: string) => {
    settingsOpener.current = null; references.cancelOpen();
    navigateWithTransition(() => {
      setSettingsOpen(false); setReturnFrame(null); setReferenceNotice(null);
      setState(previous => navigate(previous, domain, destination));
    });
  };
  const goBack = () => {
    references.cancelOpen();
    const frame = returnFrame;
    navigateWithTransition(() => { if (frame) setState(frame.state); setReturnFrame(null); setReferenceNotice(null); }, 'back');
  };
  const changeAppearance = (next: Appearance, cycled: boolean) => {
    // The compact button steps through all three choices; say so when a step leaves the screen as it was.
    if (cycled && resolveAppearance(next, systemDark) === theme) {
      toast.show({ id: 'hq-appearance', tone: 'neutral', title: `Appearance: ${APPEARANCE_LABELS[next]}`,
        description: next === 'system' ? `Follows your system, which is ${theme} right now.` : `Stays ${next} when your system changes.` });
    }
    setAppearance(next);
  };
  const skipToContent = (event: MouseEvent<HTMLAnchorElement>) => { event.preventDefault(); workspaceRef.current?.focus(); };
  useEffect(() => { if (state.domain !== 'design') void deactivateDesktopPreview(); }, [state.domain]);
  const fill = presentation[state.domain] === 'fill';

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
    const recentSaved = persist(storage, RECENT_PROJECTS_KEY, JSON.stringify(recentProjects));
    setStorageAvailable(navigationSaved && appearanceSaved && railSaved && recentSaved);
  }, [storage, state, appearance, rail, context.id, recentProjects]);

  return <div ref={shellRef} className={compact ? 'shell is-rail-compact' : 'shell'} data-hq-chrome>
    <a className="shell-skip" href="#hq-content" onClick={skipToContent}>Skip to content</a>
    <TopBar project={context} recentProjects={recentProjects} fallbackProject={CONTEXT} domain={state.domain}
      destination={state.destinations[state.domain]} settingsOpen={settingsOpen}
      returnLabel={returnFrame && !settingsOpen ? returnFrame.context.label : null} onBack={goBack}
      appearance={appearance} onAppearance={changeAppearance} storageAvailable={storageAvailable && palette.saved}
      onSelectProject={(project: RecentProject) => selectDesktopProject({ id: project.id, label: project.name })}
      onBrowseProjects={() => go('design', 'projects')} onManageSources={(source, opener) => openSettings(source, opener)} />
    <Rail current={state.domain} settingsOpen={settingsOpen} compact={compact} onNavigate={domain => go(domain)}
      onOpenSettings={opener => openSettings(null, opener)} />
    {!narrow && <Splitter label="Primary navigation width" value={rail.width} min={RAIL_MIN} max={RAIL_MAX}
      onResize={width => setRail(previous => resizeRail(previous, width))} onToggle={() => setRail(toggleRail)} />}
    <div ref={workspaceRef} id="hq-content" tabIndex={-1} className={fill ? 'workspace is-fill' : 'workspace'} data-hq-overlay={settingsOpen ? 'open' : undefined}>
      {referenceNotice && !settingsOpen && <InlineNotice className="shell-reference-notice" variant="bar" tone="info"
        title={referenceNotice.title} onDismiss={() => setReferenceNotice(null)}>{referenceNotice.message}</InlineNotice>}
      <main hidden={settingsOpen} className={fill ? `${PAGE_TRANSITION_CLASS} is-fill` : PAGE_TRANSITION_CLASS} key={`${projectMountId}:${state.domain}`}>
        <ErrorBoundary resetKeys={[projectMountId, state.domain, state.destinations[state.domain]]} title={`${DOMAIN_LABELS[state.domain]} stopped working`}>
        <Module context={context} destination={state.destinations[state.domain]} appearance={theme} desktop={window.hqDesktop ?? BROWSER_PORT}
          references={references} {...(returnFrame ? { returnContext: returnFrame.context } : {})}
          navigate={destination => { references.cancelOpen(); setState(previous => navigate(previous, state.domain, destination)); }} />
        </ErrorBoundary>
      </main>
      {settingsOpen && <ServiceSettings config={window.hqServices?.config} onClose={closeSettings}
        returnLabel={DOMAIN_LABELS[state.domain]} target={settingsTarget} appearance={appearance} onAppearanceChange={setAppearance} palette={palette} dark={theme === 'dark'} />}
    </div>
    <ToastViewport />
  </div>;
}

export function PresentationShell(props: PresentationShellProps) { return <DataSourcesProvider><WorkspaceApp {...props} /></DataSourcesProvider>; }
