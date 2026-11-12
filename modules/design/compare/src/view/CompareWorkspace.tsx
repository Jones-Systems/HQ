import {
  Button, InlineNotice, Menu, Presence, Skeleton, StatusChip, StatusIndicator, useAsyncAction, useListMotion, useReducedMotion, useToast,
} from '@hq/ui';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import type { CompareController, ControllerError } from '../controller.ts';
import { parseVersionId } from '../ids.ts';
import { baselineOf, MAX_PANELS, type Panel } from '../model.ts';
import { sameViewport } from '../presets.ts';
import { ComparePanel, type PanelActions, type PanelSlots } from './ComparePanel.tsx';
import { ActionButton, chain, flattenVersions, versionOptionLabels } from './parts.tsx';
import { SwipeStage } from './SwipeStage.tsx';
import { applyViewportMatch, planViewportMatch, SWIPE_DEFAULT, swipeAvailability, type CompareMode } from './swipe.ts';

/** What the toolbar tells the composition's slot, so tools it adds can step aside (and say why) in swipe mode. */
export interface CompareToolsContext {
  readonly mode: CompareMode;
  /** False until the comparison has a panel. */
  readonly hasPanels: boolean;
  /** True when at least one panel shows a static capture, which is what marks attach to. */
  readonly hasCapture: boolean;
}

export interface CompareWorkspaceProps extends PanelSlots {
  readonly controller: CompareController;
  readonly title?: string;
  /** Extra tools at the end of the toolbar, for example annotation tools. */
  readonly renderTools?: (context: CompareToolsContext) => ReactNode;
  /** Opens Projects, where versions are added. Without it the empty state still says where to go, but can't take you there. */
  readonly onOpenProjects?: () => void;
}

const ERROR_TEXT: Readonly<Record<ControllerError, string>> = {
  'unknown-panel': 'That panel no longer exists.',
  'duplicate-panel': 'A panel with that identity already exists.',
  'too-many-panels': 'The comparison already has the maximum number of panels.',
  'last-panel': 'A comparison keeps at least one panel.',
  'static-viewport-fixed': 'A static capture keeps the viewport it was captured at. Choose a capture at another viewport or switch to live preview.',
  'no-capture': 'That version has no static capture. Switch to live preview to view it.',
  'no-capture-at-viewport': 'This version has no capture at that viewport.',
  'capture-version-mismatch': 'The capture does not belong to the chosen version, so it is not shown.',
  'unknown-preset': 'Unknown viewport preset.',
  'unknown-version': 'That exact version is not available.',
  'save-failed': 'The layout could not be saved. Your changes are still here.',
  'disposed': 'This comparison is closed.',
};

function useActions(controller: CompareController, panel: Panel): PanelActions {
  return useMemo(() => ({
    resize: (width) => controller.resize(panel.id, width),
    scroll: (position) => controller.scroll(panel.id, position),
    setRole: (role) => controller.setRole(panel.id, role),
    applyPreset: (presetId) => controller.applyPreset(panel.id, presetId),
    selectVersion: (raw, mode) => {
      const id = parseVersionId(raw);
      if (id !== null) void controller.selectVersion(panel.id, id, mode);
    },
    addPanel: () => controller.addPanel(panel.id),
    removePanel: () => {
      const panels = controller.getSnapshot().comparison.panels;
      const at = panels.findIndex((item) => item.id === panel.id);
      const neighbour = panels[at + 1] ?? panels[at - 1];
      controller.removePanel(panel.id);
      // The removed panel took focus with it; hand it to the nearest panel's Details button.
      if (neighbour !== undefined) requestAnimationFrame(() => {
        const target = [...document.querySelectorAll('[data-panel-id]')].find((element) => element.getAttribute('data-panel-id') === neighbour.id);
        target?.querySelector<HTMLElement>('.cmp-details-toggle')?.focus();
      });
    },
  }), [controller, panel.id]);
}

function PanelSlot(props: Omit<Parameters<typeof ComparePanel>[0], 'actions'> & { readonly controller: CompareController }) {
  const { controller, ...rest } = props;
  return <ComparePanel {...rest} actions={useActions(controller, rest.panel)} />;
}

function SwipeSlot({ controller, ...rest }: Omit<Parameters<typeof SwipeStage>[0], 'baselineActions' | 'candidateActions'> & { readonly controller: CompareController }) {
  const baselineActions = useActions(controller, rest.pair.baseline);
  const candidateActions = useActions(controller, rest.pair.candidate);
  return <SwipeStage {...rest} baselineActions={baselineActions} candidateActions={candidateActions} />;
}

function useElementWidth(ref: RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return undefined;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

const PLUS = <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg>;

/** Side-by-side comparison of N pinned versions, or one baseline swiped against one candidate. All effects go through the injected controller. */
export function CompareWorkspace({ controller, title = 'Compare', renderTools, onOpenProjects, renderOverlay, renderHostSurface, overlaysOpen, rendererZoomFactor, onHostSurfacePlacement }: CompareWorkspaceProps) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const toast = useToast();
  const reduced = useReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  const width = useElementWidth(root);
  const [mode, setMode] = useState<CompareMode>('side-by-side');
  const [swipe, setSwipe] = useState(SWIPE_DEFAULT);
  const { comparison } = snapshot;
  const { panels } = comparison;
  const baseline = baselineOf(comparison);
  const leader = baseline ?? panels[0] ?? null;

  // Versions are added in Projects, away from this view, so every visit reads the catalog again.
  useEffect(() => { void controller.loadCatalog({ refresh: true }); }, [controller]);

  const catalogVersions = useMemo(() => flattenVersions(snapshot.versions), [snapshot.versions]);
  const availability = useMemo(() => swipeAvailability(panels, snapshot.runtime), [panels, snapshot.runtime]);
  const effective: CompareMode = mode === 'swipe' && availability.ok ? 'swipe' : 'side-by-side';
  const choicesFor = (panel: Panel) => {
    if (catalogVersions.length > 0) return catalogVersions;
    const own = snapshot.runtime.get(panel.id)?.version;
    return own == null ? undefined : snapshot.versions.get(own.viewId);
  };

  const strip = useListMotion<HTMLDivElement>(panels.map((panel) => panel.id));
  const known = useRef<readonly string[]>(panels.map((panel) => panel.id));
  useEffect(() => {
    const before = known.current;
    known.current = panels.map((panel) => panel.id);
    const added = known.current.find((id) => !before.includes(id));
    const scroller = strip.current;
    if (before.length === 0 || added === undefined || !scroller) return;
    // A panel added to a filled strip may land off screen; slide the strip, never the page.
    const target = [...scroller.children].find((element) => element.getAttribute('data-panel-id') === added);
    if (!target) return;
    const edge = scroller.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    const delta = box.right > edge.right ? box.right - edge.right : box.left < edge.left ? box.left - edge.left : 0;
    if (delta !== 0) scroller.scrollBy?.({ left: delta, behavior: reduced ? 'auto' : 'smooth' });
  }, [panels, reduced, strip]);

  const save = useAsyncAction(async () => {
    if (!(await controller.save())) throw new Error('Your layout changes are still on this screen. Nothing was lost.');
  }, { error: 'Couldn’t save the layout', retry: true });
  const failed = snapshot.lastError === 'save-failed';
  const saveState = save.pending ? 'saving' : failed ? 'failed' : snapshot.dirty ? 'dirty' : 'saved';

  const mismatched = leader === null ? [] : panels.filter((panel) => !sameViewport(panel.viewport, leader.viewport));
  const matchReason = leader === null ? 'Add a panel first.'
    : mismatched.length === 0 ? `Every panel already uses the ${baseline === null ? 'first panel’s' : 'baseline’s'} viewport.`
      : mismatched.every((panel) => panel.source.kind === 'static-capture')
        ? 'The other panels are static captures, which keep the viewport they were captured at.' : null;
  const matchAll = () => {
    if (leader === null) return;
    const skipped = controller.matchViewports(leader.id);
    if (skipped.length > 0) {
      toast.show({
        tone: 'info', title: 'Matched the live panels',
        description: `${skipped.length === 1 ? 'One static capture keeps' : `${skipped.length} static captures keep`} the viewport it was captured at.`,
      });
    }
  };

  let add: ReactNode;
  if (panels.length >= MAX_PANELS) {
    add = <ActionButton size="sm" reason={`A comparison holds up to ${MAX_PANELS} panels.`} onAction={() => undefined}>Add panel</ActionButton>;
  } else if (catalogVersions.length > 0) {
    const labels = versionOptionLabels(catalogVersions);
    add = <Menu size="sm" trigger={<>{PLUS} Add panel</>} items={catalogVersions.map((version) => ({
      id: version.versionId, label: labels.get(version.versionId) ?? version.label, onSelect: () => { void controller.addVersionPanel(version.versionId); },
    }))} />;
  } else {
    const loading = snapshot.catalog.status === 'idle' || snapshot.catalog.status === 'loading';
    add = <ActionButton size="sm" reason={loading ? 'Loading the versions you can add…' : 'There are no versions to add yet. Add versions in Projects.'}
      onAction={() => undefined}>Add panel</ActionButton>;
  }

  const shownError = useRef<ControllerError | null>(null);
  const inlineError = snapshot.lastError !== null && snapshot.lastError !== 'save-failed' ? snapshot.lastError : null;
  if (inlineError !== null) shownError.current = inlineError;

  const pair = availability.ok ? availability.pair : null;
  const matchPlan = pair === null ? null : planViewportMatch(pair, (panel) => snapshot.runtime.get(panel.id)?.version ?? null);
  const hasCapture = panels.some((panel) => panel.source.kind === 'static-capture');

  let content: ReactNode;
  if (panels.length === 0) {
    const loading = snapshot.catalog.status === 'idle' || snapshot.catalog.status === 'loading';
    content = <div className="cmp-empty-state hq-enter-fade" aria-busy={loading || undefined}>
      {loading ? <>
        <Skeleton shape="text" lines={2} width="240px" />
        <span role="status" className="cmp-empty-status">Loading versions…</span>
      </> : <>
        <h2>Nothing to compare yet</h2>
        <p>{catalogVersions.length > 0 ? 'Choose a version to start comparing.' : 'Add versions in Projects to compare them.'}</p>
        <div className="cmp-empty-actions">
          {catalogVersions.length > 0 && add}
          <ActionButton size="sm" variant={catalogVersions.length > 0 ? 'secondary' : 'primary'}
            reason={onOpenProjects === undefined ? 'Projects isn’t available from here.' : null} onAction={() => onOpenProjects?.()}>Open Projects</ActionButton>
        </div>
      </>}
    </div>;
  } else if (effective === 'swipe' && pair !== null) {
    content = <SwipeSlot controller={controller} pair={pair} baselineRuntime={snapshot.runtime.get(pair.baseline.id)}
      candidateRuntime={snapshot.runtime.get(pair.candidate.id)} baselineChoices={choicesFor(pair.baseline) ?? []} candidateChoices={choicesFor(pair.candidate) ?? []}
      value={swipe} onChange={setSwipe} matchPlan={matchPlan} onMatch={() => { if (matchPlan !== null) applyViewportMatch(controller, matchPlan); }}
      availableWidth={width === null ? null : width - 8} />;
  } else {
    content = <div className="cmp-strip hq-enter-fade" ref={strip}>
      {panels.map((panel, index) => <PanelSlot key={panel.id} controller={controller} panel={panel} index={index}
        runtime={snapshot.runtime.get(panel.id)} versions={choicesFor(panel)}
        preview={snapshot.preview} canRemove={panels.length > 1} canAdd={panels.length < MAX_PANELS}
        renderOverlay={renderOverlay} renderHostSurface={renderHostSurface}
        overlaysOpen={overlaysOpen} rendererZoomFactor={rendererZoomFactor} onHostSurfacePlacement={onHostSurfacePlacement} />)}
    </div>;
  }

  return <div className="cmp-workspace" ref={root}>
    <div className="cmp-toolbar" role="group" aria-label="Comparison">
      <div className="cmp-toolbar-group">
      <h1 className="hq-sr-only">{title}</h1>
      <div className="cmp-segmented" role="group" aria-label="Comparison mode">
        <Button size="sm" variant="ghost" aria-pressed={effective === 'side-by-side'} onClick={() => setMode('side-by-side')}>Side by side</Button>
        <ActionButton size="sm" variant="ghost" aria-pressed={effective === 'swipe'} reason={availability.ok ? null : availability.reason}
          onAction={() => setMode('swipe')}>Swipe</ActionButton>
      </div>
      <ActionButton size="sm" aria-pressed={comparison.syncScroll} className="cmp-sync"
        reason={effective === 'swipe' ? 'Both layers share one scroll while you swipe.' : null}
        onAction={() => controller.setSyncScroll(!comparison.syncScroll, leader?.id ?? null)}>
        Synced scroll <span className="cmp-toggle-state">{comparison.syncScroll ? 'On' : 'Off'}</span>
      </ActionButton>
      <ActionButton size="sm" reason={matchReason} onAction={matchAll}>Match viewports</ActionButton>
      {panels.length > 0 && add}
      </div>
      <div className="cmp-toolbar-group cmp-toolbar-end">
      {renderTools?.({ mode: effective, hasPanels: panels.length > 0, hasCapture })}
      <span key={saveState} className={chain('cmp-save-state', saveState === 'saved' && save.status === 'success' && 'hq-flash')}>
        {saveState === 'saving' ? <StatusIndicator tone="neutral" busy label="Saving…" />
          : saveState === 'failed' ? <StatusIndicator tone="danger" label="Couldn’t save" detail="changes kept here" action={{ label: 'Retry', onAction: () => { void save.run(); } }} />
            : saveState === 'dirty' ? <StatusIndicator tone="warning" label="Unsaved changes" />
              : <StatusIndicator tone="success" label="Saved" />}
      </span>
      <ActionButton size="sm" busy={save.pending} busyLabel="Saving…" reason={snapshot.dirty || failed || save.pending ? null : 'There are no unsaved changes.'}
        onAction={() => { void save.run(); }}>Save layout</ActionButton>
      {snapshot.preview?.qualification === 'labelled-fake' && <StatusChip tone="info" label="Labelled fake previews" className="cmp-example" />}
      </div>
    </div>
    <Presence show={inlineError !== null} motion="collapse" initial={false}>
      <div className="cmp-notice-slot">
        <InlineNotice tone="warning" variant="bar" title="Nothing changed" onDismiss={() => controller.dismissError()}>
          {shownError.current === null ? '' : ERROR_TEXT[shownError.current]}
        </InlineNotice>
      </div>
    </Presence>
    {content}
  </div>;
}
