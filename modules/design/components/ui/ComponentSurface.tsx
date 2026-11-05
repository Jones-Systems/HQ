import { useEffect, useRef, useState } from 'react';
import type { ComponentSource, MotionStudy, RenderInput } from '../src/contract.ts';
import { componentRenderRequest } from '../src/runner.ts';
import type { ComponentRun, ComponentRunnerPort } from '../src/runner.ts';

export interface ComponentSurfaceProps {
  readonly source: ComponentSource;
  readonly input: RenderInput;
  readonly runner?: ComponentRunnerPort;
  readonly motion?: { readonly study: MotionStudy; readonly time: number };
}

export function ComponentSurface({ source, input, runner, motion }: ComponentSurfaceProps) {
  const host = useRef<HTMLDivElement>(null);
  const [binding, setBinding] = useState<{ run: ComponentRun; runner: ComponentRunnerPort; source: ComponentSource; input: RenderInput } | null>(null);
  const run = binding !== null && binding.runner === runner && binding.source === source && binding.input === input ? binding.run : null;
  const [notice, setNotice] = useState('HELD · component runner unavailable');
  useEffect(() => {
    setBinding(null);
    setNotice('HELD · component runner unavailable');
    if (!runner) return;
    let disposed = false;
    let owned: ComponentRun | null = null;
    const fail = (error: unknown) => { if (!disposed) setNotice(`HELD · ${String(error)}`); };
    void componentRenderRequest(source, input).then((request) => disposed ? null : runner.render(request)).then(async (result) => {
      if (!result) return;
      if (result.status === 'unavailable') { if (!disposed) setNotice(`HELD · ${result.reason}`); return; }
      if (disposed) { await runner.close(result.value); return; }
      owned = result.value;
      setBinding({ run: owned, runner, source, input });
      setNotice(`${runner.label} · ${owned.label}`);
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
        .catch((error: unknown) => { if (live) setNotice(`HELD · ${String(error)}`); });
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
    void runner.motion(run, motion).catch((error: unknown) => { if (live) setNotice(`HELD · ${String(error)}`); });
    return () => { live = false; };
  }, [runner, run, motion]);

  return <div ref={host} className="hqc-frame" style={{ minHeight: source.size.height }} data-evidence={runner?.evidence ?? 'held'}>
    <p role="status">{notice}</p>
    {runner?.evidence === 'synthetic' ? <p>FAKE · synthetic only · not containment evidence</p> : null}
    {source.script.trim() ? <p>scripted: held pending host qualification</p> : null}
  </div>;
}
