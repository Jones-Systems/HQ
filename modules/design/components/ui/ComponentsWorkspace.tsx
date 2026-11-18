import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Button, InlineNotice, Skeleton, StateView, useToast } from '@hq/ui';
import type {
  ClockPort, ComponentId, ComponentSource, DesignSystem, MotionStudy, PropValues, RenderInput, VariantId, VariantSet,
} from '../src/contract.ts';
import { tokensUsedBy, WIDTH_PRESETS } from '../src/model/blueprint.ts';
import type { WidthPreset } from '../src/model/blueprint.ts';
import { resolveRenderInput } from '../src/model/props.ts';
import { resolveTokens } from '../src/model/tokens.ts';
import type { ComponentLibrary } from '../src/workspace/library.ts';
import { ComponentSurface } from './ComponentSurface.tsx';
import type { StageBackdrop } from './ComponentSurface.tsx';
import { HeldBlueprint } from './HeldBlueprint.tsx';
import { MotionPlayer } from './MotionPlayer.tsx';
import { PropsPanel } from './PropsPanel.tsx';
import { SegmentedControl } from './SegmentedControl.tsx';
import { TokenBoard } from './TokenBoard.tsx';
import { useChangeFlash } from './useChangeFlash.ts';
import { VariantStrip } from './VariantStrip.tsx';
import type { ComponentRunnerPort } from '../src/runner.ts';

/** What "Rate taste" sends: the component, revision and variant on the stage. The composed view turns it into a handoff. */
export interface ComponentTasteSubject {
  readonly componentId: ComponentId;
  readonly name: string;
  readonly revision: number;
  readonly variantId: VariantId | null;
  readonly variantName: string;
}

export interface ComponentsWorkspaceProps {
  /** Optional host capability. Capability-free previews omit it and show the token value instead. */
  readonly copyTokenId?: (id: string) => Promise<void>;
  readonly runner?: ComponentRunnerPort;
  readonly library: ComponentLibrary;
  readonly clock: ClockPort;
  /** Resolved HQ chrome appearance; previews keep their own color scheme. */
  readonly appearance: 'light' | 'dark';
  /** Queues the shown component and variant for a Taste rating. Omit it and the action is not offered. */
  readonly onSendToTaste?: (subject: ComponentTasteSubject) => void;
}

type Tab = 'components' | 'tokens' | 'motion';
const TABS: readonly { readonly id: Tab; readonly label: string }[] = [
  { id: 'components', label: 'Components' },
  { id: 'tokens', label: 'Tokens' },
  { id: 'motion', label: 'Motion' },
];

const BACKDROPS: readonly { readonly value: StageBackdrop; readonly label: string }[] = [
  { value: 'grid', label: 'Grid' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];
const WIDTHS: readonly { readonly value: WidthPreset; readonly label: string }[] = WIDTH_PRESETS.map((value) => ({ value, label: value === 'fit' ? 'Fit' : String(value) }));

interface Selection {
  readonly source: ComponentSource;
  readonly variants: VariantSet | null;
  readonly variantId: VariantId | null;
  readonly overrides: PropValues;
}

interface CatalogEntry {
  readonly id: ComponentId;
  readonly name: string;
  readonly revision: number;
  readonly variantCount: number;
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

/** Library: component names with their ids in mono. A strip of chips in a narrow column, a list beside the stage when wide. */
function LibraryNav({ catalog, current, onOpen }: { readonly catalog: readonly CatalogEntry[]; readonly current: ComponentId | null; readonly onOpen: (id: ComponentId) => void }) {
  return <nav className="hqc-library" aria-label="Components">
    <p className="hqc-eyebrow">Library · {catalog.length}</p>
    <ul>
      {catalog.map((entry) => <li key={entry.id}>
        <button type="button" className="hqc-lib-item hq-press" aria-current={current === entry.id ? 'true' : undefined} title={`${entry.id} · r${entry.revision} · ${entry.variantCount} variants`} onClick={() => onOpen(entry.id)}>
          <span className="hqc-lib-name">{entry.name}</span>
          <span className="hqc-lib-meta hqc-mono">{entry.id}</span>
        </button>
      </li>)}
    </ul>
  </nav>;
}

interface StageProps {
  readonly selection: Selection;
  readonly input: RenderInput;
  readonly systems: readonly DesignSystem[];
  readonly tokens: Readonly<Record<string, string>>;
  readonly runner: ComponentRunnerPort | undefined;
  readonly backdrop: StageBackdrop;
  readonly width: WidthPreset;
  readonly onBackdrop: (value: StageBackdrop) => void;
  readonly onWidth: (value: WidthPreset) => void;
  readonly onSendToTaste: ComponentsWorkspaceProps['onSendToTaste'];
}

/** The stage block: meta row, backdrop and width presets, then the surface. Nothing in it is ever transformed. */
function Stage({ selection, input, systems, tokens, runner, backdrop, width, onBackdrop, onWidth, onSendToTaste }: StageProps) {
  const { source } = selection;
  const variantName = selection.variants?.variants.find((variant) => variant.id === input.variantId)?.name ?? 'Base';
  const changes = useChangeFlash(`${source.componentId}:${source.revision}`, input.props);
  const used = useMemo(() => tokensUsedBy(systems, source.componentId, tokens), [systems, source.componentId, tokens]);
  return <div className="hqc-stage-block">
    <div className="hqc-stage-head">
      <span className="hqc-mono hqc-meta">{source.componentId} · r{source.revision} · {source.digest.slice(7, 17)}…</span>
      {onSendToTaste === undefined ? null : <Button size="sm" onClick={() => onSendToTaste({
        componentId: source.componentId, name: source.name, revision: source.revision, variantId: input.variantId, variantName,
      })} title="Queue this component and variant for a Taste rating">Rate taste</Button>}
    </div>
    <div className="hqc-stage-tools">
      <SegmentedControl label="Backdrop" options={BACKDROPS} value={backdrop} onChange={onBackdrop} />
      <SegmentedControl label="Width" options={WIDTHS} value={width} onChange={onWidth} />
    </div>
    <ComponentSurface source={source} input={input} runner={runner} backdrop={backdrop}
      held={<HeldBlueprint source={source} variantName={variantName} variantKey={input.variantId ?? '~base'} props={input.props} width={width} tokens={used} changes={changes} />} />
  </div>;
}

export function ComponentsWorkspace({ library, clock, appearance, runner, onSendToTaste, copyTokenId }: ComponentsWorkspaceProps) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('components');
  const [catalog, setCatalog] = useState<readonly CatalogEntry[]>([]);
  const [systems, setSystems] = useState<readonly DesignSystem[]>([]);
  const [studies, setStudies] = useState<readonly MotionStudy[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [reloading, setReloading] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [studyIndex, setStudyIndex] = useState(0);
  const [motionTarget, setMotionTarget] = useState<ComponentSource | null>(null);
  const [motionProblem, setMotionProblem] = useState<string | null>(null);
  const [backdrop, setBackdrop] = useState<StageBackdrop>('grid');
  const [width, setWidth] = useState<WidthPreset>('fit');
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const openTicket = useRef(0);
  const tokens = useTokens(systems);

  useEffect(() => {
    let live = true;
    setReloading(true);
    void (async () => {
      const entries: CatalogEntry[] = [];
      for (const id of await library.listComponents()) {
        const revision = (await library.revisions(id)).at(-1);
        if (revision === undefined) continue;
        const source = await library.getSource(id, revision);
        entries.push({ id, name: source.name, revision, variantCount: (await library.getVariants(source))?.variants.length ?? 0 });
      }
      const loadedSystems = await library.listDesignSystems();
      const loadedStudies: MotionStudy[] = [];
      for (const id of await library.listMotionStudies()) {
        const latest = (await library.motionRevisions(id)).at(-1);
        if (latest !== undefined) loadedStudies.push(await library.getMotionStudy(id, latest));
      }
      if (!live) return;
      setCatalog(entries);
      setSystems(loadedSystems);
      setStudies(loadedStudies);
      setLoaded(true);
      setLoadError(null);
    })().catch((error: unknown) => { if (live) setLoadError(String(error)); })
      .finally(() => { if (live) setReloading(false); });
    return () => { live = false; };
  }, [library, reloadKey]);

  const open = useCallback(async (id: ComponentId) => {
    const ticket = ++openTicket.current;
    try {
      const session = await library.getSession(id);
      const revision = session?.revision ?? (await library.revisions(id)).at(-1);
      if (revision === undefined) return;
      const source = await library.getSource(id, revision);
      const variants = await library.getVariants(source);
      if (ticket !== openTicket.current) return;
      setSelection({ source, variants, variantId: session?.variantId ?? null, overrides: session?.overrides ?? {} });
    } catch {
      if (ticket === openTicket.current) toast.error(`Could not open ${id}`, { id: 'hqc-open', description: 'The stage keeps showing what was open before.' });
    }
  }, [library, toast]);

  useEffect(() => {
    if (selection === null && catalog[0] !== undefined) void open(catalog[0].id);
  }, [catalog, selection, open]);

  const study = studies[studyIndex];
  useEffect(() => {
    let live = true;
    setMotionTarget(null);
    setMotionProblem(null);
    if (study?.component === undefined) return;
    void library.getSource(study.component.componentId, study.component.revision)
      .then((source) => { if (live) setMotionTarget(source); })
      .catch(() => { if (live) setMotionProblem('The study’s component revision is unavailable.'); });
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
      .catch(() => toast.error('Could not save your selection', { id: 'hqc-session-save', description: 'It is kept for this session only.' }));
  };

  const choose = (next: Tab) => {
    setTab(next);
    tabRefs.current[next]?.focus();
  };
  const retry = () => setReloadKey((key) => key + 1);

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
    {loadError !== null && loaded ? <InlineNotice tone="danger" title="Could not load components"
      actions={[{ label: 'Retry', onAction: retry, busy: reloading, busyLabel: 'Retrying' }]}>
      Showing what loaded earlier. Nothing was changed.
    </InlineNotice> : null}

    {!loaded && loadError !== null ? <StateView state="error" title="Could not load components" description={loadError} action={{ label: 'Try again', onAction: retry }} /> : null}
    {!loaded && loadError === null ? <div className="hqc-loading" aria-busy="true">
      <p className="hqc-visually-hidden" role="status">Loading components…</p>
      <Skeleton shape="block" height="36px" />
      <Skeleton shape="block" height="96px" />
      <Skeleton shape="block" height="220px" />
    </div> : null}

    {loaded && tab === 'components' ? <div role="tabpanel" id="hqc-panel-components" aria-labelledby="hqc-tab-components" className="hqc-bench">
      {catalog.length === 0 ? <p className="hqc-note">No components yet.</p> : <>
        <LibraryNav catalog={catalog} current={selection?.source.componentId ?? null} onOpen={(id) => void open(id)} />
        {selection === null || input === null ? <div className="hqc-loading hqc-bench-loading" aria-busy="true">
          <Skeleton shape="block" height="96px" />
          <Skeleton shape="block" height="220px" />
        </div> : <>
          <VariantStrip source={selection.source} variants={selection.variants} variantId={input.variantId}
            onSelect={(variantId) => update({ ...selection, variantId })} />
          <Stage selection={selection} input={input} systems={systems} tokens={tokens} runner={runner}
            backdrop={backdrop} width={width} onBackdrop={setBackdrop} onWidth={setWidth} onSendToTaste={onSendToTaste} />
          <PropsPanel
            source={selection.source}
            variants={selection.variants}
            variantId={input.variantId}
            overrides={selection.overrides}
            resolved={input.props}
            onOverrides={(overrides) => update({ ...selection, overrides })}
          />
        </>}
      </>}
    </div> : null}

    {loaded && tab === 'tokens' ? <div role="tabpanel" id="hqc-panel-tokens" aria-labelledby="hqc-tab-tokens">
      {systems.length === 0 ? <p className="hqc-note">No design systems yet.</p> : systems.map((system) => <TokenBoard key={system.id} system={system} copyTokenId={copyTokenId} />)}
    </div> : null}

    {loaded && tab === 'motion' ? <div role="tabpanel" id="hqc-panel-motion" aria-labelledby="hqc-tab-motion">
      {motionProblem === null ? null : <InlineNotice tone="warning" title="Study component unavailable">{motionProblem}</InlineNotice>}
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
          return saved;
        }}
      />}
    </div> : null}
  </div>;
}
