/** Pieces the side-by-side panels and the swipe stage share. */
import { Button, InlineNotice, Skeleton, type ButtonProps } from '@hq/ui';
import { useId, type ReactNode } from 'react';
import type { OverlayFrame, PreviewSession, SyntheticBlock, VersionSummary } from '../contract.ts';
import type { PanelRuntime } from '../controller.ts';
import type { Panel } from '../model.ts';

export const chain = (...names: ReadonlyArray<string | false | null | undefined>): string => names.filter(Boolean).join(' ');

/** The reason an action is unavailable, shown on hover and keyboard focus and read through `aria-describedby`. */
export function Reason({ id, children }: { readonly id: string; readonly children: ReactNode }) {
  return <span id={id} role="tooltip" className="cmp-reason hq-enter-fade">{children}</span>;
}

export interface ActionButtonProps extends Omit<ButtonProps, 'onClick' | 'disabled' | 'aria-disabled' | 'aria-describedby'> {
  /** Why the action can't run now, or null when it can. An unavailable action stays visible and focusable. */
  readonly reason: string | null;
  readonly onAction: () => void;
}

/** A button that is never silently disabled: `aria-disabled` keeps it focusable, and every activation path is guarded. */
export function ActionButton({ reason, onAction, className, children, ...rest }: ActionButtonProps) {
  const id = useId();
  return <span className="cmp-action">
    <Button {...rest} className={chain('cmp-btn', className)} aria-disabled={reason !== null ? true : undefined}
      aria-describedby={reason !== null ? id : undefined} onClick={() => { if (reason === null) onAction(); }}>{children}</Button>
    {reason !== null && <Reason id={id}>{reason}</Reason>}
  </span>;
}

export function Chevron({ open }: { readonly open: boolean }) {
  return <svg className="cmp-chevron" width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" data-open={open}><path d="m4 6 4 4 4-4" /></svg>;
}

/** Labels for a set of versions; two versions that read the same get their date so a select never offers twins. */
export function versionOptionLabels(versions: readonly VersionSummary[]): ReadonlyMap<string, string> {
  const counts = new Map<string, number>();
  for (const version of versions) counts.set(version.label, (counts.get(version.label) ?? 0) + 1);
  return new Map(versions.map((version) => [version.versionId, (counts.get(version.label) ?? 0) > 1
    ? `${version.label} (${version.createdAt.slice(0, 10)})` : version.label]));
}

export function flattenVersions(byView: ReadonlyMap<string, readonly VersionSummary[]>): readonly VersionSummary[] {
  const seen = new Set<string>();
  const all: VersionSummary[] = [];
  for (const list of byView.values()) {
    for (const version of list) {
      if (seen.has(version.versionId)) continue;
      seen.add(version.versionId);
      all.push(version);
    }
  }
  return all;
}

export function VersionSelect({ panel, runtime, choices, onSelect, className }: {
  readonly panel: Panel;
  readonly runtime: PanelRuntime | undefined;
  readonly choices: readonly VersionSummary[];
  readonly onSelect: (versionId: string) => void;
  readonly className?: string;
}) {
  const labels = versionOptionLabels(choices);
  const known = choices.some((item) => item.versionId === panel.source.versionId);
  const staticMode = panel.source.kind === 'static-capture';
  return <label className={chain('cmp-version', className)}>
    <span className="hq-sr-only">Version</span>
    <select value={panel.source.versionId} onChange={(event) => onSelect(event.target.value)}>
      {!known && <option value={panel.source.versionId}>{runtime?.version?.label ?? 'Unavailable version'}</option>}
      {choices.map((item) => {
        const noCapture = staticMode && item.captures.length === 0;
        return <option key={item.versionId} value={item.versionId} disabled={noCapture}>
          {labels.get(item.versionId)}{noCapture ? ' (no capture)' : ''}
        </option>;
      })}
    </select>
  </label>;
}

export function Synthetic({ blocks }: { readonly blocks: readonly SyntheticBlock[] }) {
  return <>{blocks.map((block, i) => <div key={i} className="cmp-block" style={{
    left: block.x, top: block.y, width: block.width, height: block.height, background: block.fill,
  }}>{block.text}</div>)}</>;
}

/** The exact frame an overlay slot is handed: source CSS pixels plus the fit scale. Null until the panel has content. */
export function buildFrame(panel: Panel, runtime: PanelRuntime | undefined, scale: number): OverlayFrame | null {
  const content = runtime?.contentSize ?? null;
  if (runtime?.version == null || content === null) return null;
  return {
    panelId: panel.id, versionId: panel.source.versionId, sourceKind: panel.source.kind,
    route: panel.source.kind === 'live-preview' ? panel.source.route : (runtime.capture?.route ?? runtime.version.route),
    state: panel.source.kind === 'live-preview' ? panel.source.state : (runtime.capture?.state ?? runtime.version.state),
    viewport: panel.viewport, scroll: panel.scroll, contentSize: content, scale,
    captureDigest: panel.source.kind === 'static-capture' ? panel.source.captureDigest : null,
  };
}

/** What a ready panel draws inside the scaled source frame: its capture, a labelled fake preview or a hosted surface. */
export function Surface({ panel, runtime, frame, renderHostSurface, label }: {
  readonly panel: Panel;
  readonly runtime: PanelRuntime;
  readonly frame: OverlayFrame;
  readonly renderHostSurface?: (session: PreviewSession, frame: OverlayFrame) => ReactNode;
  readonly label: string;
}) {
  const content = runtime.contentSize!;
  if (panel.source.kind === 'static-capture' && runtime.imageSrc != null) {
    return <img className="cmp-capture" src={runtime.imageSrc} width={content.width} height={content.height}
      alt={`Static capture of ${label}`} draggable={false} />;
  }
  if (runtime.session == null) return null;
  const session = runtime.session;
  return session.surface.kind === 'synthetic' ? <Synthetic blocks={session.surface.blocks} />
    : renderHostSurface?.(session, frame) ?? <p className="cmp-message">Hosted preview surface requires root integration.</p>;
}

/** A panel that has no capture to draw yet: a skeleton while it loads, an in-place notice when it can't. */
export function PendingStage({ runtime, panel, width, height, label }: {
  readonly runtime: PanelRuntime | undefined;
  readonly panel: Panel;
  readonly width: number;
  readonly height: number;
  readonly label: string;
}) {
  const status = runtime?.status ?? 'loading';
  if (status === 'loading') {
    return <div className="cmp-scroller cmp-pending" aria-busy="true" style={{ width, height }}>
      <Skeleton shape="block" width="100%" height="100%" />
      <span className="cmp-pending-label" role="status">{panel.source.kind === 'live-preview' ? 'Loading preview…' : 'Loading capture…'}</span>
    </div>;
  }
  const failed = status === 'failed';
  return <div className="cmp-scroller cmp-pending" style={{ width, height }}>
    <InlineNotice tone={failed ? 'danger' : status === 'stale' ? 'warning' : 'info'} className="cmp-pending-notice"
      title={failed ? `Can't show ${label}` : status === 'stale' ? 'Preview is out of date' : 'Not available here'}
      live={failed ? undefined : 'off'}>
      {runtime?.error ?? 'Nothing to show yet.'}
    </InlineNotice>
  </div>;
}
