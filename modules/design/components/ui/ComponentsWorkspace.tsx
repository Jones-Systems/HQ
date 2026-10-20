import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type {
  ClockPort, ComponentId, ComponentSource, DesignSystem, MotionStudy, PropValues, VariantId, VariantSet,
} from '../src/contract.ts';
import { resolveRenderInput } from '../src/model/props.ts';
import { resolveTokens } from '../src/model/tokens.ts';
import type { ComponentLibrary } from '../src/workspace/library.ts';
import { MotionPlayer } from './MotionPlayer.tsx';
import { PropsPanel } from './PropsPanel.tsx';
import { ComponentSurface } from './ComponentSurface.tsx';
import type { ComponentRunnerPort } from '../src/runner.ts';
import { TokenBoard } from './TokenBoard.tsx';

export interface ComponentsWorkspaceProps {
  readonly runner?: ComponentRunnerPort;
  readonly library: ComponentLibrary;
  readonly clock: ClockPort;
  /** Resolved HQ chrome appearance; previews keep their own color scheme. */
  readonly appearance: 'light' | 'dark';
}

type Tab = 'components' | 'tokens' | 'motion';
const TABS: readonly { readonly id: Tab; readonly label: string }[] = [
  { id: 'components', label: 'Components' },
  { id: 'tokens', label: 'Tokens' },
  { id: 'motion', label: 'Motion' },
];

interface Selection {
  readonly source: ComponentSource;
  readonly variants: VariantSet | null;
  readonly variantId: VariantId | null;
  readonly overrides: PropValues;
}

function useTokens(systems: readonly DesignSystem[]): Readonly<Record<string, string>> {
  return useMemo(() => Object.assign({}, ...systems.map((system) => resolveTokens(system).values)), [systems]);
}

/** Roving-tab keyboard model for the section tabs. */
function onTabKey(event: KeyboardEvent<HTMLButtonElement>, current: Tab, choose: (tab: Tab) => void) {
  const index = TABS.findIndex((tab) => tab.id === current);
  const next = event.key === 'ArrowRight' ? (index + 1) % TABS.length
    : event.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : -1;
  if (next < 0) return;
  event.preventDefault();
  choose((TABS[next] as { id: Tab }).id);
}

export function ComponentsWorkspace({ library, clock, appearance, runner }: ComponentsWorkspaceProps) {
  const [tab, setTab] = useState<Tab>('components');
  const [componentIds, setComponentIds] = useState<readonly ComponentId[]>([]);
  const [systems, setSystems] = useState<readonly DesignSystem[]>([]);
  const [studies, setStudies] = useState<readonly MotionStudy[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [studyIndex, setStudyIndex] = useState(0);
  const [motionTarget, setMotionTarget] = useState<ComponentSource | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const tokens = useTokens(systems);

  useEffect(() => {
    let live = true;
    void (async () => {
      const ids = await library.listComponents();
      const loadedSystems = await library.listDesignSystems();
      const loadedStudies: MotionStudy[] = [];
      for (const id of await library.listMotionStudies()) {
        const latest = (await library.motionRevisions(id)).at(-1);
        if (latest !== undefined) loadedStudies.push(await library.getMotionStudy(id, latest));
      }
      if (!live) return;
      setComponentIds(ids);
      setSystems(loadedSystems);
      setStudies(loadedStudies);
    })().catch((error: unknown) => { if (live) setNotice(`Could not load components: ${String(error)}`); });
    return () => { live = false; };
  }, [library]);

  const open = useCallback(async (id: ComponentId) => {
    const session = await library.getSession(id);
    const revision = session?.revision ?? (await library.revisions(id)).at(-1);
    if (revision === undefined) return;
    const source = await library.getSource(id, revision);
    const variants = await library.getVariants(source);
    setSelection({ source, variants, variantId: session?.variantId ?? null, overrides: session?.overrides ?? {} });
  }, [library]);

  useEffect(() => {
    if (selection === null && componentIds[0] !== undefined) void open(componentIds[0]);
  }, [componentIds, selection, open]);

  const study = studies[studyIndex];
  useEffect(() => {
    let live = true;
    setMotionTarget(null);
    if (study?.component === undefined) return;
    void library.getSource(study.component.componentId, study.component.revision)
      .then((source) => { if (live) setMotionTarget(source); })
      .catch(() => { if (live) setNotice('The study’s component revision is unavailable.'); });
    return () => { live = false; };
  }, [library, study]);

  const input = useMemo(() => {
    if (selection === null) return null;
    try {
      return resolveRenderInput(selection.source, selection.variants, selection.variantId, selection.overrides, tokens);
    } catch {
      return resolveRenderInput(selection.source, selection.variants, null, {}, tokens);
    }
  }, [selection, tokens]);

  const motionInput = useMemo(() => (motionTarget === null ? null : resolveRenderInput(motionTarget, null, null, {}, tokens)), [motionTarget, tokens]);

  const update = (next: Selection) => {
    setSelection(next);
    // Only the panel session is persisted; the source revision is never written here.
    void library.saveSession(next.source, next.variants, next.variantId, next.overrides)
      .catch(() => setNotice('The selection could not be saved; it is kept for this session only.'));
  };

  const choose = (next: Tab) => {
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  return <div className="hqc-root" data-appearance={appearance}>
    <div className="hqc-tabs" role="tablist" aria-label="Components and motion">
      {TABS.map((item) => <button
        key={item.id}
        ref={(element) => { tabRefs.current[item.id] = element; }}
        type="button"
        role="tab"
        id={`hqc-tab-${item.id}`}
        aria-selected={tab === item.id}
        aria-controls={`hqc-panel-${item.id}`}
        tabIndex={tab === item.id ? 0 : -1}
        onClick={() => setTab(item.id)}
        onKeyDown={(event) => onTabKey(event, tab, choose)}
      >{item.label}</button>)}
    </div>
    {notice === null ? null : <p className="hqc-notice" role="status">{notice}</p>}

    {tab === 'components' ? <div role="tabpanel" id="hqc-panel-components" aria-labelledby="hqc-tab-components" className="hqc-split">
      <nav className="hqc-list" aria-label="Components">
        <ul>
          {componentIds.map((id) => <li key={id}>
            <button type="button" aria-current={selection?.source.componentId === id ? 'true' : undefined} onClick={() => void open(id)}>{id}</button>
          </li>)}
        </ul>
      </nav>
      {selection === null || input === null ? <p className="hqc-note">No components yet.</p> : <>
        <div className="hqc-stage">
          <ComponentSurface source={selection.source} input={input} runner={runner} />
        </div>
        <PropsPanel
          source={selection.source}
          variants={selection.variants}
          variantId={selection.variantId}
          overrides={selection.overrides}
          resolved={input.props}
          onSelectVariant={(variantId) => update({ ...selection, variantId })}
          onOverrides={(overrides) => update({ ...selection, overrides })}
        />
      </>}
    </div> : null}

    {tab === 'tokens' ? <div role="tabpanel" id="hqc-panel-tokens" aria-labelledby="hqc-tab-tokens">
      {systems.length === 0 ? <p className="hqc-note">No design systems yet.</p> : systems.map((system) => <TokenBoard key={system.id} system={system} />)}
    </div> : null}

    {tab === 'motion' ? <div role="tabpanel" id="hqc-panel-motion" aria-labelledby="hqc-tab-motion">
      {studies.length > 1 ? <label className="hqc-field">Study
        <select value={studyIndex} onChange={(event) => setStudyIndex(Number(event.target.value))}>
          {studies.map((item, index) => <option key={item.id} value={index}>{item.title}</option>)}
        </select>
      </label> : null}
      {study === undefined ? <p className="hqc-note">No motion studies yet.</p> : <MotionPlayer
        study={study}
        target={motionTarget === null || motionInput === null ? null : { source: motionTarget, input: motionInput }}
        clock={clock}
        runner={runner}
        onSaveDraft={async (draft) => {
          const saved = await library.saveMotionStudy(draft);
          setStudies((current) => current.map((item, index) => (index === studyIndex ? saved : item)));
        }}
      />}
    </div> : null}
  </div>;
}
