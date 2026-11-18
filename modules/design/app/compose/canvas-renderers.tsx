/**
 * What the canvas draws inside its item frames, supplied by composition: the capture thumbnail of a project
 * version, and the title and step count of a flow. Both load lazily through the caches in `canvas-load-cache.ts`,
 * so a frame shows a skeleton while it loads and a labelled fallback when there is nothing to draw. The canvas adds
 * the caption, so a renderer never draws over its own capture.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { Skeleton } from '@hq/ui';
import type { DesignSectionProps } from '../../ui/contract.ts';
import type { CanvasItemRenderer } from '../../canvas/src/view/index.ts';
import { PROVENANCE_LABELS } from '../../canvas/src/inspector.ts';
import { FLOWS_PROVIDER_ID } from '../../flows/src/canvas.ts';
import { captureKey, type CaptureValue, type FlowSummary, type Loaded, type LoadCache } from './canvas-load-cache.ts';
import { PROJECT_VERSIONS_PROVIDER_ID } from './project-versions.ts';

function useLoaded<T>(cache: LoadCache<T>, key: string): Loaded<T> {
  useEffect(() => { cache.want(key); }, [cache, key]);
  return useSyncExternalStore(cache.subscribe, () => cache.peek(key), () => cache.peek(key));
}

function Placeholder({ text }: { text: string }) {
  return <div className="hq-canvas-placeholder"><span>{text}</span></div>;
}

/**
 * The capture inside its frame. The well is marked as preserved content and carries the shared capture surface, so
 * chrome themes, filters and blend modes never reach the pixels. A fallback is a labelled placeholder, never a blank.
 */
export function CaptureBody({ cache, entityId, revision, title, surface }: {
  cache: LoadCache<CaptureValue>; entityId: string; revision: string; title: string; surface: DesignSectionProps['surface'];
}) {
  const loaded = useLoaded(cache, captureKey(entityId, revision));
  if (loaded.status === 'loading') return <div className="hq-canvas-skeleton" aria-busy="true"><Skeleton shape="block" /></div>;
  if (loaded.status === 'failed') return <Placeholder text="Capture unavailable" />;
  if (loaded.value === null) return <Placeholder text="No capture yet" />;
  const props = surface('capture');
  return <div {...props} className="hq-canvas-capture" data-hq-content="captured" role="img" aria-label={`Capture of ${title}`}
    style={{ ...props.style, backgroundColor: 'var(--hq-artwork-matte)' }}>
    <img src={loaded.value.url} alt="" draggable={false} decoding="async" />
  </div>;
}

function FlowBody({ cache, entityId, kind }: { cache: LoadCache<FlowSummary>; entityId: string; kind: string }) {
  const loaded = useLoaded(cache, entityId);
  const label = kind === 'flow-player' ? 'Prototype' : 'Flow map';
  if (loaded.status === 'loading') return <div className="hq-canvas-skeleton" aria-busy="true"><Skeleton shape="block" /></div>;
  if (loaded.status === 'failed') return <Placeholder text={`${label} unavailable`} />;
  const { title, steps } = loaded.value;
  return <div className="hq-canvas-summary"><strong>{title}</strong><span>{label} · {steps} {steps === 1 ? 'step' : 'steps'}</span></div>;
}

/** Renderers keyed by provider id. A provider without one shows the canvas's labelled placeholder. */
export function createCanvasRenderers(options: {
  readonly captures: LoadCache<CaptureValue>;
  readonly flows: LoadCache<FlowSummary>;
  readonly surface: DesignSectionProps['surface'];
}): Readonly<Record<string, CanvasItemRenderer>> {
  const { captures, flows, surface } = options;
  return {
    [PROJECT_VERSIONS_PROVIDER_ID]: (descriptor) => ({
      body: <CaptureBody cache={captures} entityId={descriptor.ref.entityId} revision={descriptor.ref.revision} title={descriptor.title} surface={surface} />,
      meta: `${descriptor.intrinsicSize.width}×${descriptor.intrinsicSize.height} · ${PROVENANCE_LABELS[descriptor.provenance]}`,
    }),
    [FLOWS_PROVIDER_ID]: (descriptor) => ({
      body: <FlowBody cache={flows} entityId={descriptor.ref.entityId} kind={descriptor.kind} />,
      meta: PROVENANCE_LABELS[descriptor.provenance],
    }),
  };
}
