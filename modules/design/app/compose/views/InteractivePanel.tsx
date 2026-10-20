import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@hq/ui';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import { AnnotationList } from '../../../annotations/src/ui/AnnotationsPanel.tsx';
import { anchorMatches } from '../interactive-workspace.ts';
import { interactiveTarget } from '../runtime-ports.ts';
import { useDesignWorkspace } from '../workspace-context.tsx';

export function InteractivePanel({ context, navigate }: Pick<DesignSectionProps, 'context' | 'navigate'>) {
  const { interactive } = useDesignWorkspace();
  const snapshot = useSyncExternalStore(interactive.subscribe, interactive.snapshot, interactive.snapshot);
  const { selected, session, annotations, capture, error, flow } = snapshot;
  const busy = snapshot.busy || snapshot.held;
  const placeholder = useRef<HTMLDivElement>(null);
  const [route, setRoute] = useState('');
  const [device, setDevice] = useState<'auto' | 'phone' | 'desktop'>('auto');
  const [proposal, setProposal] = useState('');
  const [revisitOnly, setRevisitOnly] = useState(false);
  useEffect(() => { void interactive.refresh(); return () => { void interactive.deactivate(); }; }, [interactive]);
  useEffect(() => { if (session) setRoute(session.route + session.state); }, [session?.route, session?.state]);
  useEffect(() => {
    if (!session) return;
    const timer = globalThis.setInterval(() => { void interactive.poll(); }, 500);
    return () => globalThis.clearInterval(timer);
  }, [interactive, session?.sessionId]);
  useEffect(() => {
    const element = placeholder.current;
    if (!element || !session) return;
    let previous = '';
    const place = () => {
      const rect = element.getBoundingClientRect();
      const overlay = document.querySelector('[role="dialog"], [aria-modal="true"], dialog[open], [data-hq-overlay="open"]');
      const visible = !document.hidden && !overlay && rect.width > 0 && rect.height > 0
        && rect.top >= 0 && rect.left >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth;
      const placement = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
      const key = JSON.stringify([placement, visible]);
      if (key === previous) return;
      previous = key;
      void interactive.place(placement, visible);
    };
    const size = new ResizeObserver(place); size.observe(element);
    const overlays = new MutationObserver(place); overlays.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'role', 'aria-modal', 'hidden', 'data-hq-overlay'] });
    window.addEventListener('resize', place); document.addEventListener('scroll', place, true); document.addEventListener('visibilitychange', place);
    place();
    return () => { size.disconnect(); overlays.disconnect(); window.removeEventListener('resize', place); document.removeEventListener('scroll', place, true); document.removeEventListener('visibilitychange', place); };
  }, [interactive, session?.sessionId]);
  const documentState = annotations?.snapshot.editor.document;
  const target = selected ? interactiveTarget(selected) : null;
  const bound = selected?.entry.sourceProjectId === context.id;
  const stale = documentState?.annotations.some((annotation) => !anchorMatches(annotation.anchor, capture, snapshot.version));
  return <section aria-label="Interactive project" className="hqp-detail">
    <h2>Interactive project</h2>
    <p>Select an enrolled web prototype or website. Image collections remain static references.</p>
    {!interactive.catalogAvailable && <p role="status">Source catalog not connected. Enroll a source in Settings.</p>}
    <div className="hqp-toolbar">
      <label>Source project <select aria-label="Interactive source project" value={selected?.entry.sourceProjectId ?? ''} disabled={busy}
        onChange={(event) => { const item = snapshot.items.find((item) => item.entry.sourceProjectId === event.target.value); if (item) void interactive.select(item); }}>
        <option value="">Choose a source project</option>
        {snapshot.items.map((item) => <option key={item.entry.sourceProjectId} value={item.entry.sourceProjectId}>
          {item.entry.displayName} · {String(item.entry.metadata.experienceKind ?? 'source only')} · {item.freshness}
        </option>)}
      </select></label>
      <Button variant="secondary" disabled={busy || !interactive.catalogAvailable} onClick={() => void interactive.refresh()}>Refresh sources</Button>
      <label>Viewport <select aria-label="Preview viewport" value={device} disabled={busy || session !== null} onChange={(event) => setDevice(event.target.value as 'auto' | 'phone' | 'desktop')}><option value="auto">Source default</option><option value="phone">Phone · 390 × 844</option><option value="desktop">Desktop · 1024 × 720</option></select></label>
      <Button disabled={busy || !target || !interactive.available || !bound} onClick={() => void interactive.open(device === 'auto' ? undefined : device === 'phone' ? { w: 390, h: 844, dpr: 1 } : { w: 1024, h: 720, dpr: 1 })}>Open live preview</Button>
      {session && <Button variant="secondary" disabled={snapshot.busy} onClick={() => void interactive.close()}>Close preview</Button>}
    </div>
    {selected && <p>{selected.hostLabel} · {selected.freshness} · Source identity <code>{selected.entry.sourceProjectId}</code></p>}
    {selected && !bound && <p role="status">Select this source in the project context before opening it. Project selection sends nothing.</p>}
    {selected && !target && <p role="status">{selected.entry.metadata.experienceKind === 'stills' ? 'Still images: use the existing reference import workflow.' : String(selected.entry.metadata.holdReason ?? 'No available interactive presentation.')}</p>}
    {!interactive.available && <p role="status">Live preview unavailable. Durable storage and a qualified desktop preview connection are required.</p>}
    {error && <p role="alert">{error}</p>}
    {snapshot.notice && <p role="status">{snapshot.notice}</p>}
    {session && <>
      <p>Live preview: runs this site's code with normal browser network access; isolated from HQ</p>
      <div className="hqp-toolbar">
        <Button variant="secondary" disabled={busy || snapshot.history.length < 2} onClick={() => void interactive.back()}>Back</Button>
        <label>Route <input aria-label="Preview route" value={route} maxLength={2048} onChange={(event) => setRoute(event.target.value)} /></label>
        <Button variant="secondary" disabled={busy} onClick={() => void interactive.navigate(route)}>Go</Button>
        <Button variant="secondary" disabled={busy} onClick={() => annotations?.selectTool(null)}>Browse</Button>
        <Button variant="secondary" disabled={busy || !annotations?.canPickOrCite} onClick={() => annotations?.selectTool('pick')}>Pick</Button>
        <Button variant="secondary" disabled={busy || !annotations?.canPickOrCite} onClick={() => annotations?.selectTool('cite')}>Cite</Button>
        <Button disabled={busy} onClick={() => void interactive.capture()}>Capture</Button>
        <Button variant="secondary" disabled={busy || !capture} onClick={() => void interactive.addScreen()}>Add screen to flow</Button>
      </div>
      {!session.pickQualified && <p role="status">Pick and Cite remain unavailable until the host’s coherent capture qualification passes.</p>}
      <p>Observed route: {session.route} · State: {session.state || '(empty hash)'} · {session.viewport.w} × {session.viewport.h} at {session.viewport.dpr}× · {session.status}</p>
      <div ref={placeholder} aria-label="Host live preview surface" style={{ width: '100%', height: 420, border: '1px solid var(--hq-border-control)', background: 'var(--hq-surface)' }}>
        <p>Live content appears in the desktop preview surface. It hides while HQ dialogs are open or the surface is outside the visible window.</p>
      </div>
      {annotations && <>
        <label>Comment for next Pick or Cite <textarea aria-label="Comment for next mark" rows={2} maxLength={4000} value={annotations.snapshot.pendingNote} onChange={(event) => annotations.setPendingNote(event.target.value)} /></label>
        {stale && <p role="status">Some annotations belong to another route, state, viewport or capture. Their anchors remain stale; capturing a new frame does not rebind them.</p>}
        <AnnotationList annotations={documentState?.annotations ?? []} revisit={new Set(documentState?.revisit ?? [])} statuses={new Map(annotations.snapshot.resolved.map((item) => [item.annotation.id, item.status]))}
          selectedId={null} readOnly={annotations.snapshot.readOnly} revisitOnly={revisitOnly} onRevisitOnly={setRevisitOnly}
          onSelect={() => undefined} onNote={(id, note) => { annotations.setNote(id, note); void interactive.saveAnnotations(); }}
          onToggleRevisit={(id) => { annotations.toggleRevisit(id); void interactive.saveAnnotations(); }} onDelete={(id) => { annotations.remove(id); void interactive.saveAnnotations(); }} />
        <div className="hqp-toolbar"><Button variant="secondary" disabled={busy} onClick={() => void interactive.saveAnnotations()}>Save annotations</Button>
          <Button variant="secondary" disabled={busy || !capture} onClick={() => void interactive.resolve()}>Resolve current anchors</Button></div>
      </>}
      {snapshot.image && <details><summary>Saved coherent capture</summary><img src={snapshot.image} alt={`Capture of ${capture?.route}`} style={{ maxWidth: '100%' }} /></details>}
      <label>Change proposal <textarea aria-label="Change proposal" rows={3} maxLength={8000} value={proposal} onChange={(event) => setProposal(event.target.value)} /></label>
      <Button disabled={busy || !capture || !proposal.trim() || !selected?.entry.revision} onClick={() => void interactive.createProposal(proposal)}>Save unsent proposal</Button>
      <Button variant="secondary" onClick={() => navigate({ nav: 'requests', section: 'requests' })}>Open Requests</Button>
      <p>Proposals include only annotations matching the current capture and stay on this device. Review and freeze a request, then explicitly confirm its destination in Runs. Capture images are not attached to sends.</p>
    </>}
    {flow && <section aria-label="Captured flow"><h3>{flow.title}</h3><ol>{flow.screens.map((screen) => <li key={screen.id}>
      {screen.title} · state {screen.state} · {screen.viewport.w} × {screen.viewport.h} · <code>{screen.captureDigest}</code>
    </li>)}</ol></section>}
  </section>;
}
