import { withSectionErrorBoundary } from './SectionErrorBoundary.tsx';
import { use, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { animateElement, Button, InlineNotice, useReducedMotion, useToast } from '@hq/ui';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import type { FlowDocument, Screen } from '../../../flows/src/contract.ts';
import { flowId, projectId as flowProjectId } from '../../../flows/src/contract.ts';
import { FlowsWorkspace, type FlowsUi } from '../../../flows/src/views.ts';
import '../../../flows/src/flows.css';
import { FAKE_TAG, SYNTHETIC_TAG } from '../labels.ts';
import { useFlowCapturePreviews } from '../flow-captures.ts';
import { interactiveTarget, type InteractiveCatalogItem } from '../runtime-ports.ts';
import { sendToTaste, useHandoffQueue } from '../sources/taste-handoff.ts';

import { useDesignWorkspace } from '../workspace-context.tsx';
import { InteractivePanel } from './InteractivePanel.tsx';
import { SectionFrame } from './SectionFrame.tsx';

type DesignWorkspace = import('../workspace.ts').DesignWorkspace;

const screensText = (count: number): string => `${count} ${count === 1 ? 'screen' : 'screens'}`;

/** F1's motion and notice primitives, handed to the section, which never imports `@hq/ui` itself. */
function useFlowsUi(): FlowsUi {
  const reduced = useReducedMotion();
  return useMemo<FlowsUi>(() => ({
    motion: { reduced, animate: animateElement },
    notice: (notice) => <InlineNotice tone={notice.tone} title={notice.title}>{notice.detail}</InlineNotice>,
  }), [reduced]);
}

/** "Rate this flow": queues the flow for Taste and confirms with one toast that can open Taste. Nothing is rated here. */
function useRateFlow(flow: FlowDocument | null, navigate: DesignSectionProps['navigate']): { readonly onRate?: () => void; readonly rated?: boolean } {
  const toast = useToast();
  const queue = useHandoffQueue();
  if (flow === null) return {};
  return {
    rated: queue.some((item) => item.kind === 'flow' && item.id === flow.id),
    onRate: () => { sendToTaste({ id: flow.id, kind: 'flow', label: flow.title, detail: screensText(flow.screens.length), from: 'flows' }, navigate, toast); },
  };
}

/** Flows whose screens pin exact project versions; the binding of each screen is shown, never assumed. */
function FlowsViewContent({ context, navigate }: DesignSectionProps) {
  const workspace = useDesignWorkspace();
  if (workspace.bridged) return <BridgedFlows context={context} navigate={navigate} workspace={workspace} />;
  return <ExampleFlows context={context} navigate={navigate} workspace={workspace} />;
}

function ExampleFlows({ context, navigate, workspace }: { navigate: DesignSectionProps['navigate']; context: DesignSectionProps['context']; workspace: Extract<DesignWorkspace, { bridged: false }> }) {
  const { flow, binding, previews, warm } = use(workspace.flowsFor(context));
  const ui = useFlowsUi();
  const rate = useRateFlow(flow, navigate);
  return <SectionFrame lane="T11 flows" entry="flows/src/views.ts › FlowsWorkspace" tags={[FAKE_TAG, SYNTHETIC_TAG]}
    notes={[previews.label, `${warm.loaded} thumbnails verified, ${warm.failed.length} failed`]}>
    <FlowsWorkspace key={flow.id} flow={flow} previews={previews} ui={ui} {...rate}
      pins={{ scope: `project ${flow.projectId}`, sameProject: binding.sameProject, items: binding.screens }} />
  </SectionFrame>;
}

/** A captured state is the JSON string of the URL hash; anything else is not a live location. */
function liveLocation(screen: Screen): string | null {
  if (screen.state === '') return screen.route;
  try { const hash: unknown = JSON.parse(screen.state); return typeof hash === 'string' && (hash === '' || hash.startsWith('#')) ? screen.route + hash : null; }
  catch { return null; }
}

/** The three steps that make a first flow, shown instead of a bare sentence. The live preview below does the work. */
function NoFlowsYet({ onShowPreview }: { onShowPreview: () => void }) {
  return <section className="hqd-flows__empty hq-enter-rise" aria-labelledby="hqd-flows-empty-title">
    <h2 id="hqd-flows-empty-title">No saved flows for this project yet</h2>
    <p>A flow is a set of captured pages you can step through. Build one from the live preview below.</p>
    <ol className="hqd-flows__guide hq-stagger">
      <li>
        <span className="hqd-flows__guide-n" aria-hidden="true">1</span>
        <div className="hqd-flows__guide-text">
          <strong>Open the live preview</strong>
          <span>In the panel below, choose a source and select Open live preview.</span>
          <Button className="hqd-flows__guide-action" size="sm" variant="secondary" onClick={onShowPreview}>Go to the live preview</Button>
        </div>
      </li>
      <li>
        <span className="hqd-flows__guide-n" aria-hidden="true">2</span>
        <div className="hqd-flows__guide-text">
          <strong>Capture a page</strong>
          <span>Browse to the page you want in the preview, then select Capture.</span>
        </div>
      </li>
      <li>
        <span className="hqd-flows__guide-n" aria-hidden="true">3</span>
        <div className="hqd-flows__guide-text">
          <strong>Add the screen to the flow</strong>
          <span>Select Add screen to flow. Repeat for each page; the flow appears here once it has a screen.</span>
        </div>
      </li>
    </ol>
    <span className="hqd-flows__muted">Live preview needs durable storage and a desktop preview connection. The panel below says when it is unavailable.</span>
  </section>;
}

function BridgedFlows({ context, navigate, workspace }: { navigate: DesignSectionProps['navigate']; context: DesignSectionProps['context']; workspace: Extract<DesignWorkspace, { bridged: true }> }) {
  const { flows: stored, readCapture, repository } = use(workspace.flowsFor(context));
  const { interactive } = workspace;
  const toast = useToast();
  const ui = useFlowsUi();
  const live = useSyncExternalStore(interactive.subscribe, interactive.snapshot, interactive.snapshot);
  const [elsewhere, setElsewhere] = useState<readonly { readonly item: InteractiveCatalogItem; readonly flow: FlowDocument }[]>([]);
  // Other enrolled sources' saved interactive flows, read by their exact flow ID. Choosing one selects
  // that source exactly as the Source selector does; nothing is opened or sent.
  useEffect(() => {
    let current = true;
    const candidates = live.items.filter((item) => String(item.entry.sourceProjectId) !== context.id && interactiveTarget(item) !== null);
    void Promise.all(candidates.map(async (item) => {
      try {
        const loaded = await repository.load(flowId(`interactive-${item.entry.sourceProjectId}`));
        return loaded.status === 'ok' && loaded.flow.screens.length > 0 ? { item, flow: loaded.flow } : null;
      } catch { return null; }
    })).then((found) => { if (current) setElsewhere(found.filter((entry) => entry !== null)); });
    return () => { current = false; };
  }, [live.items, context.id, repository]);
  const panel = useRef<HTMLDivElement>(null);
  // Screens added in this session are saved before the listing is read again, so the live copy is newer.
  const fresh = live.flow !== null && live.flow.projectId === flowProjectId(context.id) ? live.flow : null;
  const flows: readonly FlowDocument[] = fresh === null ? stored
    : stored.some((flow) => flow.id === fresh.id) ? stored.map((flow) => flow.id === fresh.id ? fresh : flow) : [...stored, fresh];
  const [chosen, setChosen] = useState<string | null>(null);
  const flow = flows.find((item) => item.id === chosen) ?? flows.find((item) => live.selected !== null && String(item.projectId) === String(live.selected.entry.sourceProjectId)) ?? flows[0] ?? null;
  const previews = useFlowCapturePreviews(flow?.screens ?? [], readCapture);
  const rate = useRateFlow(flow, navigate);
  // Live navigation is offered only into an open preview of this flow's exact source.
  const bound = flow !== null && live.session !== null && !live.busy && !live.held && live.selected !== null && String(live.selected.entry.sourceProjectId) === String(flow.projectId);
  const openLive = bound ? (screen: Screen) => {
    const location = liveLocation(screen);
    if (location === null) {
      toast.show({ tone: 'warning', title: 'This screen cannot be opened live', meta: 'Its captured state is not a page location' });
      return;
    }
    void interactive.navigate(location);
    panel.current?.scrollIntoView({ block: 'start' });
  } : undefined;
  const switcher = flows.length > 1 || elsewhere.length > 0
    ? <div className="hqd-flows__switcher" role="group" aria-label="Saved flows">
      <span className="hqd-flows__label">Saved flows</span>
      <div className="hqd-flows__segmented">
        {flows.map((item) => <button key={item.id} type="button" className="hqd-flows__seg" aria-pressed={item.id === flow?.id} onClick={() => setChosen(item.id)}>
          {item.title} <small>{screensText(item.screens.length)}</small>
        </button>)}
        {elsewhere.map(({ item, flow: other }) => <button key={other.id} type="button" className="hqd-flows__seg" aria-pressed={false} disabled={live.busy || live.held}
          title={`Switches the project to ${item.entry.displayName}`} onClick={() => void interactive.select(item)}>
          {other.title} <small>{screensText(other.screens.length)}</small>
        </button>)}
      </div>
    </div>
    : null;
  return <SectionFrame lane="T11 flows" entry="flows/src/views.ts › FlowsWorkspace" tags={[workspace.storageTag]}>
    <>
      {flow
        ? <FlowsWorkspace key={flow.id} flow={flow} previews={previews} ui={ui} {...rate} {...(switcher ? { switcher } : {})} {...(openLive ? { onOpenLive: openLive } : {})} />
        : <div className="hqd-flows">{switcher}<NoFlowsYet onShowPreview={() => panel.current?.scrollIntoView({ block: 'start' })} /></div>}
    </>
    <div ref={panel} style={{ marginTop: 24, scrollMarginTop: 16 }}>
      <InteractivePanel context={context} navigate={navigate} />
    </div>
  </SectionFrame>;
}

export const FlowsView = withSectionErrorBoundary(FlowsViewContent, true);
