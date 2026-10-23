import { withSectionErrorBoundary } from './SectionErrorBoundary.tsx';
import { use, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import type { FlowDocument, Screen } from '../../../flows/src/contract.ts';
import { flowId, projectId as flowProjectId } from '../../../flows/src/contract.ts';
import { FlowsWorkspace } from '../../../flows/src/views.ts';
import { FAKE_TAG, SYNTHETIC_TAG } from '../labels.ts';
import { useFlowCapturePreviews } from '../flow-captures.ts';
import { interactiveTarget, type InteractiveCatalogItem } from '../runtime-ports.ts';

import { useDesignWorkspace } from '../workspace-context.tsx';
import { InteractivePanel } from './InteractivePanel.tsx';
import { SectionFrame } from './SectionFrame.tsx';

/** Flows whose screens pin exact project versions; the binding of each screen is shown, never assumed. */
function FlowsViewContent({ context, navigate }: DesignSectionProps) {
  const workspace = useDesignWorkspace();
  if (workspace.bridged) return <BridgedFlows context={context} navigate={navigate} workspace={workspace} />;
  const { flow, binding, previews, warm } = use(workspace.flowsFor(context));
  return <SectionFrame lane="T11 flows" entry="flows/src/views.ts › FlowsWorkspace" tags={[FAKE_TAG, SYNTHETIC_TAG]}
    notes={[previews.label, `${warm.loaded} thumbnails verified, ${warm.failed.length} failed`]}>
    <details className="hqd-compose-note" open>
      <summary>Pinned project versions ({binding.sameProject ? `project ${flow.projectId}` : 'flow belongs to another project'})</summary>
      <ul>{binding.screens.map((screen) => <li key={screen.screenId}>{screen.screenId} → <code>{screen.versionId}</code>: {screen.binding}</li>)}</ul>
    </details>
    <FlowsWorkspace key={flow.id} flow={flow} previews={previews} />
  </SectionFrame>;
}

/** A captured state is the JSON string of the URL hash; anything else is not a live location. */
function liveLocation(screen: Screen): string | null {
  if (screen.state === '') return screen.route;
  try { const hash: unknown = JSON.parse(screen.state); return typeof hash === 'string' && (hash === '' || hash.startsWith('#')) ? screen.route + hash : null; }
  catch { return null; }
}

function BridgedFlows({ context, navigate, workspace }: { navigate: DesignSectionProps['navigate']; context: DesignSectionProps['context']; workspace: Extract<import('../workspace.ts').DesignWorkspace, { bridged: true }> }) {
  const { flows: stored, readCapture, repository } = use(workspace.flowsFor(context));
  const { interactive } = workspace;
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
  // Live navigation is offered only into an open preview of this flow's exact source.
  const bound = flow !== null && live.session !== null && !live.busy && !live.held && live.selected !== null && String(live.selected.entry.sourceProjectId) === String(flow.projectId);
  const openLive = bound ? (screen: Screen) => {
    const location = liveLocation(screen);
    if (location === null) return;
    void interactive.navigate(location);
    panel.current?.scrollIntoView({ block: 'start' });
  } : undefined;
  return <SectionFrame lane="T11 flows" entry="flows/src/views.ts › FlowsWorkspace" tags={[workspace.storageTag]}>
    <>
      {(flows.length > 1 || elsewhere.length > 0) && <div role="group" aria-label="Saved flows" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 12 }}>
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>Saved flows</span>
        {flows.map((item) => <button key={item.id} type="button" aria-pressed={item.id === flow?.id} onClick={() => setChosen(item.id)}
          style={item.id === flow?.id ? { borderColor: 'var(--accent)', boxShadow: 'inset 0 0 0 1px var(--accent)', fontWeight: 600 } : undefined}>
          {item.title} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>· {item.screens.length} {item.screens.length === 1 ? 'screen' : 'screens'}</span>
        </button>)}
        {elsewhere.map(({ item, flow: other }) => <button key={other.id} type="button" aria-pressed={false} disabled={live.busy || live.held}
          title={`Switches the project to ${item.entry.displayName}`} onClick={() => void interactive.select(item)}>
          {other.title} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>· {other.screens.length} {other.screens.length === 1 ? 'screen' : 'screens'}</span>
        </button>)}
      </div>}
      {flow ? <FlowsWorkspace key={flow.id} flow={flow} previews={previews} {...(openLive ? { onOpenLive: openLive } : {})} />
        : <p>No saved flows for this project yet. Open the live preview below, Capture a page and choose Add screen to flow.</p>}
    </>
    <div ref={panel} style={{ marginTop: 24, scrollMarginTop: 16 }}>
      <InteractivePanel context={context} navigate={navigate} />
    </div>
  </SectionFrame>;
}

export const FlowsView = withSectionErrorBoundary(FlowsViewContent, true);
