import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button, StatusChip } from '@hq/ui';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import { AnnotationList } from '../../../annotations/src/ui/AnnotationsPanel.tsx';
import { anchorMatches } from '../interactive-workspace.ts';
import { describePreviewError, fitFrame, frameFullyVisible, reviewBeside, stageHeightBudget, type FrameBox, type FrameFit } from '../preview-frame.ts';
import { findPreview, openPreviewSource, previewCollection, previewGroups, previewIdentity, previewKey, previewKind, previewUnavailableReason } from '../preview-navigation.ts';
import { interactiveTarget } from '../runtime-ports.ts';
import { screenName, stateLabel } from '../../../flows/src/presentation.ts';
import { useDesignWorkspace } from '../workspace-context.tsx';
import './interactive-workbench.css';

const MODES = [{ tool: null, label: 'Browse' }, { tool: 'pick', label: 'Pick' }, { tool: 'cite', label: 'Cite' }] as const;
const OVERLAYS = '[role="dialog"], [aria-modal="true"], dialog[open], [data-hq-overlay="open"]';

function scrollportOf(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return null;
}

function innerBox(element: HTMLElement): FrameBox {
  const rect = element.getBoundingClientRect();
  return { x: rect.x + element.clientLeft, y: rect.y + element.clientTop, width: element.clientWidth, height: element.clientHeight };
}

/**
 * The live site is a native view composited above this renderer, so it cannot be clipped or covered.
 * The frame element is sized to the logical viewport and is the only region the view may occupy.
 */
export function InteractivePanel({ context, navigate }: Pick<DesignSectionProps, 'context' | 'navigate'>) {
  const { interactive } = useDesignWorkspace();
  const snapshot = useSyncExternalStore(interactive.subscribe, interactive.snapshot, interactive.snapshot);
  const { selected, session, annotations, capture, error, flow } = snapshot;
  const busy = snapshot.busy || snapshot.held;
  const revealedSession = useRef<string | null>(null);
  const panel = useRef<HTMLElement>(null);
  const workbench = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const closePreview = useRef<HTMLButtonElement>(null);
  const [route, setRoute] = useState('');
  const [device, setDevice] = useState<'auto' | 'phone' | 'desktop'>('auto');
  const [proposal, setProposal] = useState('');
  const [revisitOnly, setRevisitOnly] = useState(false);
  const [fit, setFit] = useState<FrameFit | null>(null);
  const [beside, setBeside] = useState(false);
  const [paused, setPaused] = useState(false);
  const fitted = useRef(false);
  fitted.current = fit !== null && fit.width > 0;
  const placeNow = useRef<(() => void) | null>(null);
  const viewportW = session?.viewport.w, viewportH = session?.viewport.h;
  useEffect(() => { void interactive.refresh(); return () => { void interactive.deactivate(); }; }, [interactive]);
  useEffect(() => { if (session) setRoute(session.route + session.state); }, [session?.route, session?.state]);
  useEffect(() => {
    if (!session) return;
    const timer = globalThis.setInterval(() => { void interactive.poll(); }, 500);
    return () => globalThis.clearInterval(timer);
  }, [interactive, session?.sessionId]);
  // Fit the logical viewport into the stage width and one scrollport height, never enlarging the page.
  useLayoutEffect(() => {
    const root = panel.current, bench = workbench.current, box = stage.current;
    if (!root || !bench || !box || !viewportW || !viewportH) { setFit(null); return; }
    const scroller = scrollportOf(root);
    const measure = () => {
      const rootRect = root.getBoundingClientRect(), stageRect = box.getBoundingClientRect(), benchRect = bench.getBoundingClientRect();
      const height = stageHeightBudget(scroller?.clientHeight ?? window.innerHeight, stageRect.top - rootRect.top, benchRect.bottom - stageRect.bottom);
      setBeside(reviewBeside(root.clientWidth, height, { w: viewportW, h: viewportH }));
      const next = fitFrame({ width: box.clientWidth, height }, { w: viewportW, h: viewportH });
      setFit((previous) => previous && previous.width === next.width && previous.height === next.height ? previous : next);
    };
    const size = new ResizeObserver(measure); size.observe(root); size.observe(box); if (scroller) size.observe(scroller);
    window.addEventListener('resize', measure);
    measure();
    return () => { size.disconnect(); window.removeEventListener('resize', measure); };
  }, [session?.sessionId, viewportW, viewportH]);
  useEffect(() => {
    const element = frame.current;
    if (!element || !session) return;
    const scroller = panel.current ? scrollportOf(panel.current) : null;
    let previous = '', last: { x: number; y: number; width: number; height: number } | null = null;
    const send = (placement: NonNullable<typeof last>, visible: boolean) => {
      const key = JSON.stringify([placement, visible]);
      if (key === previous) return;
      previous = key;
      void interactive.place(placement, visible);
    };
    const place = () => {
      // Unfitted boxes (the pre-fit fallback, a collapsed panel) are never sent: an oversized placement could
      // land after the fitted one. The last fitted placement is hidden instead, which keeps its size.
      if (!fitted.current) { setPaused(false); if (last) send(last, false); return; }
      const rect = element.getBoundingClientRect();
      const clips = [{ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }, ...(scroller ? [innerBox(scroller)] : [])];
      const inView = frameFullyVisible({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }, clips);
      const visible = inView && !document.hidden && !document.querySelector(OVERLAYS);
      setPaused(!inView && rect.width > 0 && rect.height > 0);
      last = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
      send(last, visible);
    };
    const size = new ResizeObserver(place); size.observe(element);
    const overlays = new MutationObserver(place); overlays.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'role', 'aria-modal', 'hidden', 'data-hq-overlay'] });
    window.addEventListener('resize', place); document.addEventListener('scroll', place, true); document.addEventListener('visibilitychange', place);
    place(); placeNow.current = place;
    return () => { placeNow.current = null; size.disconnect(); overlays.disconnect(); window.removeEventListener('resize', place); document.removeEventListener('scroll', place, true); document.removeEventListener('visibilitychange', place); };
  }, [interactive, session?.sessionId]);
  // A fit that leaves the frame box unchanged produces no resize observation, so place explicitly.
  useEffect(() => { placeNow.current?.(); }, [fit]);
  useEffect(() => {
    if (!session) { revealedSession.current = null; return; }
    if (snapshot.busy || revealedSession.current === session.sessionId) return;
    revealedSession.current = session.sessionId;
    panel.current?.scrollIntoView({ block: 'start' });
    closePreview.current?.focus({ preventScroll: true });
  }, [session?.sessionId, snapshot.busy]);
  const grouped = previewGroups(snapshot.items);
  const resume = snapshot.bookmark ? findPreview(snapshot.items, snapshot.bookmark) : null;
  const documentState = annotations?.snapshot.editor.document;
  const marks = documentState?.annotations ?? [];
  const target = selected ? interactiveTarget(selected) : null;
  const bound = selected?.entry.sourceProjectId === context.id;
  const stale = marks.some((annotation) => !anchorMatches(annotation.anchor, capture, snapshot.version));
  const tool = annotations?.snapshot.editor.tool ?? null;
  const marking = tool === 'pick' || tool === 'cite';
  const hint = tool === 'pick' ? 'Pick: click an element on the page to mark it.'
    : tool === 'cite' ? 'Cite: select text on the page to quote it.'
    : session && !session.pickQualified ? 'Pick and Cite stay off until this host passes coherent capture qualification.'
    : 'Use the site normally, then Capture to annotate this frame.';
  const status = snapshot.notice ?? hint;
  const flowCard = flow && <section aria-label="Captured flow" className="hqw-card">
    <details><summary>{flow.title} · {flow.screens.length} {flow.screens.length === 1 ? 'screen' : 'screens'}</summary>
      <ol className="hqw-flow">{flow.screens.map((screen) => <li key={screen.id}>
        <span title={screen.route}>{screenName(screen)}</span>{stateLabel(screen.state) ? ` · ${stateLabel(screen.state)}` : ''} · {screen.viewport.w} × {screen.viewport.h} · <code title={screen.captureDigest}>{screen.captureDigest?.slice(7, 19)}</code>
      </li>)}</ol>
    </details>
  </section>;
  return <section ref={panel} aria-label="Interactive project" className="hqw-panel">
    {!session && <div className="hqw-intro">
      <h2>Interactive project</h2>
      <p>Open an enrolled website or web prototype. Image collections stay static references.</p>
    </div>}
    <div className="hqw-header">
      <label className="hqw-source"><span>Source</span><select aria-label="Interactive source project" value={selected ? previewKey(previewIdentity(selected)) : ''} disabled={busy}
        onChange={(event) => { const item = snapshot.items.find((item) => previewKey(previewIdentity(item)) === event.target.value); if (item) void interactive.select(item); }}>
        <option value="">Choose a source project</option>
        {grouped.groups.map((group) => <optgroup key={group.key} label={group.label}>
          {group.items.map((item) => <option key={previewKey(previewIdentity(item))} value={previewKey(previewIdentity(item))}>{item.entry.displayName} · {previewKind(item)}{item.freshness !== 'fresh' ? ` · ${item.freshness}` : ''}</option>)}
        </optgroup>)}
        {grouped.unavailable.length > 0 && <optgroup label="Not interactive">
          {grouped.unavailable.map((item) => <option disabled key={previewKey(previewIdentity(item))} value={previewKey(previewIdentity(item))}>{item.entry.displayName} · {previewUnavailableReason(item)}</option>)}
        </optgroup>}
      </select></label>
      {selected && selected.freshness !== 'fresh' && <StatusChip tone="warning" label={selected.freshness.charAt(0).toUpperCase() + selected.freshness.slice(1)} />}
      <Button size="sm" variant="ghost" disabled={busy || !interactive.catalogAvailable} onClick={() => void interactive.refresh()}>Refresh sources</Button>
      {!session && <label className="hqw-viewport"><span>Viewport</span><select aria-label="Preview viewport" value={device} disabled={busy} onChange={(event) => setDevice(event.target.value as 'auto' | 'phone' | 'desktop')}><option value="auto">Source default</option><option value="phone">Phone · 390 × 844</option><option value="desktop">Desktop · 1024 × 720</option></select></label>}
      <span className="hqw-spacer" />
      {session
        ? <Button ref={closePreview} disabled={snapshot.busy} onClick={() => void interactive.close()}>Close preview</Button>
        : <Button variant="primary" disabled={busy || !target || !interactive.available || !bound} onClick={() => void interactive.open(device === 'auto' ? undefined : device === 'phone' ? { w: 390, h: 844, dpr: 1 } : { w: 1024, h: 720, dpr: 1 })}>Open live preview</Button>}
    </div>
    <div className="hqw-notes">
      {!interactive.catalogAvailable && <p role="status">Source catalog not connected. Enroll a source in Settings.</p>}
      {!session && snapshot.bookmark && <div aria-label="Resume preview">
        {resume && interactiveTarget(resume)
          ? <Button variant="secondary" disabled={busy || !interactive.available || !interactive.selectProjectAvailable} onClick={() => void openPreviewSource(interactive, snapshot.bookmark!)}>Resume {previewCollection(resume)}/{resume.entry.displayName}</Button>
          : <p role="status">Saved preview unavailable. {previewUnavailableReason(resume)} Your bookmark is retained.</p>}
      </div>}
      {selected && !bound && <p role="status">Select this source in the project context before opening it. Project selection sends nothing.</p>}
      {selected && !target && <p role="status">{selected.entry.metadata.experienceKind === 'stills' ? 'Still images: use the existing reference import workflow.' : String(selected.entry.metadata.holdReason ?? 'No available interactive presentation.')}</p>}
      {!interactive.available && <p role="status">Live preview unavailable. Durable storage and a qualified desktop preview connection are required.</p>}
      {!session && error && <p role="alert">{describePreviewError(error)}</p>}
      {!session && snapshot.notice && <p role="status">{snapshot.notice}</p>}
    </div>
    {session && <div className={beside ? 'hqw-body is-beside' : 'hqw-body'}>
      <section ref={workbench} aria-label="Live preview workbench" className="hqw-workbench">
        <form className="hqw-bar" aria-label="Preview navigation and tools" onSubmit={(event) => { event.preventDefault(); void interactive.navigate(route); }}>
          <Button size="sm" variant="ghost" disabled={busy || snapshot.history.length < 2} onClick={() => void interactive.back()}>Back</Button>
          <label className="hqw-route"><span className="hqw-visually-hidden">Route</span>
            <input aria-label="Preview route" title={`Observed: ${session.route}${session.state}`} spellCheck={false} value={route} maxLength={2048} onChange={(event) => setRoute(event.target.value)} /></label>
          <Button size="sm" type="submit" disabled={busy}>Go</Button>
          <span className="hqw-chip" title="Logical viewport and display scale">{session.viewport.w} × {session.viewport.h}{session.viewport.dpr > 1 ? ` @${session.viewport.dpr}×` : ''}{fit && fit.width > 0 ? ` · ${Math.round(fit.scale * 100)}%` : ''}</span>
          {session.status === 'crashed' && <StatusChip tone="danger" label="Crashed" detail="Close and reopen" />}
          <span className="hqw-spacer" />
          <div role="group" aria-label="Annotation mode" className="hqw-modes">
            {MODES.map((mode) => <Button key={mode.label} size="sm" aria-pressed={mode.tool === null ? !marking : tool === mode.tool}
              disabled={busy || (mode.tool !== null && !annotations?.canPickOrCite)} onClick={() => annotations?.selectTool(mode.tool)}>{mode.label}</Button>)}
          </div>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => void interactive.capture()}>Capture</Button>
        </form>
        <div className="hqw-context">
          {error ? <p role="alert" className="hqw-message is-error" title={error}>{describePreviewError(error)}</p>
            : <p role="status" className="hqw-message" title={status}>{status}</p>}
          {marking && annotations && <input className="hqw-comment" aria-label="Comment for next mark" placeholder="Comment for the next mark (optional)" maxLength={4000}
            value={annotations.snapshot.pendingNote} onChange={(event) => annotations.setPendingNote(event.target.value)} />}
        </div>
        <div ref={stage} className="hqw-stage" style={fit ? { height: fit.height } : undefined}>
          <div ref={frame} aria-label="Host live preview surface" className="hqw-frame"
            style={fit ? { width: fit.width, height: fit.height } : { width: '100%', aspectRatio: `${session.viewport.w} / ${session.viewport.h}` }}>
            {paused
              ? <div className="hqw-frame-note"><p>Preview paused while it is out of view.</p>
                <Button size="sm" onClick={() => { panel.current?.scrollIntoView({ block: 'start' }); workbench.current?.querySelector<HTMLElement>('.hqw-modes [aria-pressed="true"]')?.focus({ preventScroll: true }); }}>Show preview</Button></div>
              : <p className="hqw-visually-hidden">Live content appears in the desktop preview surface. It hides while HQ dialogs are open or the surface is out of view.</p>}
          </div>
        </div>
        <p className="hqw-caption">Live preview: runs this site's code with normal browser network access; isolated from HQ</p>
      </section>
      <aside aria-label="Review" className="hqw-review">
        <section aria-labelledby="hqw-capture-heading" className="hqw-card">
          <h3 id="hqw-capture-heading">Capture</h3>
          {capture && snapshot.image && <img src={snapshot.image} alt={`Capture of ${capture.route}`} className="hqw-thumb" />}
          <p className="hqw-muted">{capture ? <>Saved {capture.route}{capture.state} · <code title={capture.captureDigest}>{capture.captureDigest.slice(7, 19)}</code></> : 'Capture this frame to annotate it, add it to the flow or propose changes.'}</p>
          <div className="hqw-actions"><Button size="sm" disabled={busy || !capture} onClick={() => void interactive.addScreen()}>Add screen to flow</Button></div>
        </section>
        {annotations && <section aria-labelledby="hqw-annotations-heading" className="hqw-card">
          <h3 id="hqw-annotations-heading">Annotations{marks.length > 0 ? ` · ${marks.length}` : ''}</h3>
          {stale && <p role="status" className="hqw-muted">Some annotations belong to another route, state, viewport or capture. They stay stale; a new capture does not rebind them.</p>}
          <AnnotationList annotations={marks} revisit={new Set(documentState?.revisit ?? [])} statuses={new Map(annotations.snapshot.resolved.map((item) => [item.annotation.id, item.status]))}
            selectedId={null} readOnly={annotations.snapshot.readOnly} revisitOnly={revisitOnly} onRevisitOnly={setRevisitOnly}
            onSelect={() => undefined} onNote={(id, note) => { annotations.setNote(id, note); void interactive.saveAnnotations(); }}
            onToggleRevisit={(id) => { annotations.toggleRevisit(id); void interactive.saveAnnotations(); }} onDelete={(id) => { annotations.remove(id); void interactive.saveAnnotations(); }} />
          <div className="hqw-actions"><Button size="sm" disabled={busy} onClick={() => void interactive.saveAnnotations()}>Save annotations</Button>
            <Button size="sm" variant="ghost" disabled={busy || !capture} onClick={() => void interactive.resolve()}>Check anchors</Button></div>
        </section>}
        <section aria-labelledby="hqw-proposal-heading" className="hqw-card">
          <h3 id="hqw-proposal-heading">Proposal</h3>
          <textarea aria-label="Change proposal" placeholder="Describe the change you want" rows={3} maxLength={8000} value={proposal} onChange={(event) => setProposal(event.target.value)} />
          <div className="hqw-actions"><Button size="sm" variant="primary" disabled={busy || !capture || !proposal.trim() || !selected?.entry.revision} onClick={() => void interactive.createProposal(proposal)}>Save unsent proposal</Button>
            <Button size="sm" variant="ghost" onClick={() => navigate({ nav: 'requests', section: 'requests' })}>Open Requests</Button></div>
          <p className="hqw-muted">Saved on this device with only the annotations matching the current capture; capture images are not attached. Review and freeze it in Requests, then explicitly confirm its destination in Runs.</p>
        </section>
        {flowCard}
        {selected && <section aria-labelledby="hqw-source-heading" className="hqw-card">
          <h3 id="hqw-source-heading">Source</h3>
          <p className="hqw-muted">{selected.hostLabel} · {selected.freshness}</p>
          <p className="hqw-muted">Identity <code className="hqw-identity">{selected.entry.sourceProjectId}</code></p>
        </section>}
      </aside>
    </div>}
    {!session && flowCard}
  </section>;
}
