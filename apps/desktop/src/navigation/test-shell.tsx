import { useEffect, useRef, useState } from 'react';
import { DOMAIN_IDS, type Appearance, type DomainId, type ReferenceEnvelope } from '@hq/contracts';
import type { ReferenceProvider, ReturnContext } from '@hq/contracts/references';
import { DOMAIN_LABELS } from '../domain-metadata';
import { createReferencePort } from '../references';
import { DEFAULT_STATE, navigate, type ShellState } from '../state';
import { CommandPalette, ReturnPill, useDocumentTitle, useShellShortcuts } from './index';
import type { SettingsTarget } from './commands';

/**
 * A small stand-in for the HQ shell, wired exactly the way the real shell mounts these components: the same
 * navigate, Back and Settings behaviour with the real reference port and fake modules. Test support only.
 */
export const projectId = 'hq-local';

export function workProvider(items: readonly { id: string; title: string }[], find?: ReferenceProvider['find']): ReferenceProvider {
  const envelope = (item: { id: string; title: string }): ReferenceEnvelope => ({
    version: 1, domain: 'work', projectId, kind: 'item', entityId: item.id, title: item.title, returnDestination: { domain: 'work', destination: `item/${item.id}` },
  });
  return {
    domain: 'work', kinds: ['item'],
    find: find ?? (async (query, scope) => items.filter(item => item.title.toLowerCase().includes(query.toLowerCase())).slice(0, scope.limit).map(envelope)),
    resolve: async value => ({ status: 'available', observedAt: new Date().toISOString(), destination: `item/${value.entityId}` }),
  };
}

/** Like Design: handles Ctrl+K itself while focus is inside it (or nowhere) and calls preventDefault. */
function DesignStub({ destination }: { destination: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const inside = event.target instanceof Node && root.current?.contains(event.target);
      if (event.defaultPrevented || open || !(inside || event.target === document.body)) return;
      if (event.ctrlKey && event.key.toLowerCase() === 'k') { event.preventDefault(); setOpen(true); }
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, [open]);
  return <div ref={root}>
    <input aria-label="Design draft" />
    {open && <div role="dialog" aria-modal="true" aria-label="Design palette"><button onClick={() => setOpen(false)}>Close Design palette</button></div>}
    <span>Design at {destination}</span>
  </div>;
}

export interface TestShellProps {
  readonly providers?: readonly ReferenceProvider[];
  readonly initial?: Partial<ShellState>;
  readonly mac?: boolean;
  readonly trace?: (row: Readonly<Record<string, string | boolean | null>>) => void;
}

export function TestShell({ providers = [], initial, mac = false, trace }: TestShellProps) {
  const [state, setState] = useState<ShellState>({ ...DEFAULT_STATE, ...initial });
  const stateRef = useRef(state); stateRef.current = state;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTarget, setSettingsTarget] = useState<SettingsTarget>(null);
  const [appearance, setAppearance] = useState<Appearance>('system');
  const [returnFrame, setReturnFrame] = useState<{ context: ReturnContext; state: ShellState } | null>(null);
  const [notice, setNotice] = useState('');
  const [references] = useState(() => createReferencePort(providers, {
    projectId: () => projectId,
    notice: value => setNotice(`${value.title}: ${value.message}`),
    open(envelope, destination, context) {
      trace?.({ phase: 'reference.open', current: `${stateRef.current.domain}:${stateRef.current.destinations[stateRef.current.domain]}`,
        destination: `${envelope.domain}:${destination}`, returnTo: `${context.to.domain}:${context.to.destination}` });
      setSettingsOpen(false); setNotice('');
      setReturnFrame({ context, state: navigate(stateRef.current, context.to.domain, context.to.destination) });
      setState(previous => navigate(previous, envelope.domain, destination));
    },
  }));
  const switchDomain = (domain: DomainId, destination?: string) => {
    setSettingsOpen(false); references.cancelOpen(); setReturnFrame(null); setNotice('');
    setState(previous => navigate(previous, domain, destination));
  };
  const goBack = () => {
    trace?.({ phase: 'goBack', frame: returnFrame ? `${returnFrame.state.domain}:${returnFrame.state.destinations[returnFrame.state.domain]}` : null });
    references.cancelOpen();
    if (returnFrame) setState(returnFrame.state);
    setReturnFrame(null);
  };
  const openSettings = (target: SettingsTarget) => { setSettingsTarget(target); setSettingsOpen(true); };
  useShellShortcuts({ switchDomain, openSettings: () => openSettings(null) }, { mac });
  useDocumentTitle({ domain: state.domain, settingsOpen });
  trace?.({ phase: 'render', current: `${state.domain}:${state.destinations[state.domain]}`,
    frame: returnFrame ? `${returnFrame.state.domain}:${returnFrame.state.destinations[returnFrame.state.domain]}` : null, settingsOpen });

  return <div>
    <nav aria-label="Domains">{DOMAIN_IDS.map(domain => <button key={domain} aria-current={!settingsOpen && state.domain === domain ? 'page' : undefined} onClick={() => switchDomain(domain)}>{DOMAIN_LABELS[domain]}</button>)}</nav>
    <button onClick={() => openSettings(null)}>Settings</button>
    <main>
      <ReturnPill label={returnFrame ? returnFrame.context.label : null} onBack={goBack} hidden={settingsOpen} mac={mac} />
      {notice && <p role="status">{notice}</p>}
      <p data-testid="location">{state.domain}:{state.destinations[state.domain]}</p>
      <p data-testid="appearance">{appearance}</p>
      {state.domain === 'design' ? <DesignStub destination={state.destinations.design} /> : <section aria-label={`${DOMAIN_LABELS[state.domain]} module`}><input aria-label={`${DOMAIN_LABELS[state.domain]} draft`} />At {state.destinations[state.domain]}</section>}
      {settingsOpen && <section role="region" aria-label="Settings page" data-target={String(settingsTarget)}>Settings target {String(settingsTarget)}</section>}
    </main>
    <CommandPalette domain={state.domain} destinations={state.destinations} settingsOpen={settingsOpen} projectId={projectId} appearance={appearance}
      references={references} returnFrame={returnFrame ? { label: returnFrame.context.label, onBack: goBack } : null} mac={mac}
      onNavigate={switchDomain} onOpenSettings={openSettings} onAppearance={setAppearance} />
  </div>;
}
