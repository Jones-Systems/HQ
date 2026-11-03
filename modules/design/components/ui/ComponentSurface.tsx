import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { InlineNotice, StatusIndicator } from '@hq/ui';
import type { ComponentSource, MotionStudy, RenderInput } from '../src/contract.ts';
import { componentRenderRequest } from '../src/runner.ts';
import type { ComponentRun, ComponentRunnerPort } from '../src/runner.ts';

export type StageBackdrop = 'grid' | 'light' | 'dark';

export interface ComponentSurfaceProps {
  readonly source: ComponentSource;
  readonly input: RenderInput;
  readonly runner?: ComponentRunnerPort;
  readonly motion?: { readonly study: MotionStudy; readonly time: number };
  /**
   * HQ-drawn content for the stage while no run owns it (the held blueprint, the motion proxy). It must be built
   * from metadata only. A qualified runner replaces it: the stage host is then left empty for the native overlay.
   */
  readonly held?: ReactNode;
  readonly backdrop?: StageBackdrop;
}

/** Vertical room kept around a held blueprint inside the stage. */
const STAGE_PADDING = 32;

type Phase =
  | { readonly kind: 'held'; readonly reason: string | null }
  | { readonly kind: 'starting' }
  | { readonly kind: 'running'; readonly label: string };

/**
 * Plain-words reason for the hold. The two enablement items are the qualification gates in
 * docs/engineering-specs/hq-integration-parallel-execution.md.
 */
function WhyHeld({ scripted, reason }: { readonly scripted: boolean; readonly reason: string | null }) {
  return <details className="hqc-why">
    <summary>Why?</summary>
    <div className="hqc-why-body">
      <p>Showing a component means running its markup, styles and scripts. HQ does that only inside a native, isolated runner, and no runner has passed qualification yet.</p>
      <p>Static components wait for <code className="hqc-mono">ac.component-static-enablement.001</code>. Scripted components also wait for <code className="hqc-mono">ac.component-scripted-enablement.001</code>.{scripted ? ' This component has a script, so it stays held until that second gate.' : ''}</p>
      <p>Until then the stage is a blueprint drawn from the declared size, props and tokens. Nothing from the component runs or renders here.</p>
      {reason === null ? null : <p>Runner said: <span className="hqc-mono">{reason}</span></p>}
    </div>
  </details>;
}

/**
 * The stage. Without a qualified runner it shows `held` and one calm notice. With a runner it asks for a render and
 * reports the stage rectangle so the native overlay can follow it. The host element is never transformed while a run
 * exists, because a transform moves the box without a resize event and the overlay would drift.
 */
export function ComponentSurface({ source, input, runner, motion, held, backdrop = 'grid' }: ComponentSurfaceProps) {
  const host = useRef<HTMLDivElement>(null);
  const [binding, setBinding] = useState<{ run: ComponentRun; runner: ComponentRunnerPort; source: ComponentSource; input: RenderInput } | null>(null);
  const run = binding !== null && binding.runner === runner && binding.source === source && binding.input === input ? binding.run : null;
  const [phase, setPhase] = useState<Phase>(() => (runner ? { kind: 'starting' } : { kind: 'held', reason: null }));
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    setBinding(null);
    setProblem(null);
    setPhase(runner ? { kind: 'starting' } : { kind: 'held', reason: null });
    if (!runner) return;
    let disposed = false;
    let owned: ComponentRun | null = null;
    const fail = (error: unknown) => { if (!disposed) setPhase({ kind: 'held', reason: String(error) }); };
    void componentRenderRequest(source, input).then((request) => disposed ? null : runner.render(request)).then(async (result) => {
      if (!result) return;
      if (result.status === 'unavailable') { if (!disposed) setPhase({ kind: 'held', reason: result.reason }); return; }
      if (disposed) { await runner.close(result.value); return; }
      owned = result.value;
      setBinding({ run: owned, runner, source, input });
      setPhase({ kind: 'running', label: `${runner.label} · ${owned.label}` });
    }).catch(fail);
    return () => { disposed = true; if (owned) void runner.close(owned).catch(() => {}); };
  }, [runner, source, input]);

  useEffect(() => {
    if (!runner || !run || !host.current) return;
    let live = true;
    const report = () => {
      const rect = host.current?.getBoundingClientRect();
      if (!rect) return;
      void runner.place(run, { x: rect.x, y: rect.y, width: rect.width, height: rect.height, visible: !document.hidden && rect.width > 0 && rect.height > 0 })
        .catch((error: unknown) => { if (live) setProblem(String(error)); });
    };
    report();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(report);
    observer?.observe(host.current);
    window.addEventListener('resize', report);
    window.addEventListener('scroll', report, true);
    document.addEventListener('visibilitychange', report);
    return () => { live = false; observer?.disconnect(); window.removeEventListener('resize', report); window.removeEventListener('scroll', report, true); document.removeEventListener('visibilitychange', report); };
  }, [runner, run]);

  useEffect(() => {
    if (!runner || !run || !motion) return;
    let live = true;
    void runner.motion(run, motion).catch((error: unknown) => { if (live) setProblem(String(error)); });
    return () => { live = false; };
  }, [runner, run, motion]);

  const scripted = source.script.trim() !== '';
  return <div className="hqc-surface">
    <div ref={host} className="hqc-frame" data-evidence={runner?.evidence ?? 'held'} data-run={run === null ? 'none' : 'active'} data-backdrop={backdrop}
      style={{ minHeight: source.size.height + STAGE_PADDING }}>
      {run === null ? held : null}
    </div>
    {phase.kind === 'held' ? <div className="hqc-held" data-held-notice="true">
      <InlineNotice tone="info" live="off" title="Preview held">
        Component code runs only in a qualified, isolated runner. Props, variants, tokens and motion stay editable.
      </InlineNotice>
      <WhyHeld scripted={scripted} reason={phase.reason} />
    </div> : null}
    {phase.kind === 'starting' ? <StatusIndicator tone="neutral" busy label="Starting runner" detail={runner?.label} /> : null}
    {phase.kind === 'running' && runner?.evidence !== 'synthetic' ? <StatusIndicator tone="success" label="Rendered" detail={phase.label} /> : null}
    {problem === null ? null : <InlineNotice tone="warning" title="The runner reported a problem">{problem}</InlineNotice>}
    {runner?.evidence === 'synthetic' && phase.kind === 'running' ? <p className="hqc-fake" role="note"><b>FAKE</b> · synthetic only · not containment evidence</p> : null}
  </div>;
}
