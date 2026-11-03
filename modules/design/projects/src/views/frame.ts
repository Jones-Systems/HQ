import { createElement as h, useRef } from 'react';
import type { PreviewRef } from '../contract.ts';
import type { Priority, ThumbnailLoader } from '../loader.ts';
import { useThumbnail } from './hooks.ts';
import { useProjectsUi } from './ui.ts';

export interface CaptureFrameProps {
  readonly loader: ThumbnailLoader;
  readonly preview: PreviewRef | undefined;
  readonly priority: Priority;
  /** False until the grid is measured, so a provisional first layout requests nothing. */
  readonly live?: boolean;
  /** `cover` fills the frame (project covers); `contain` keeps the whole capture visible. */
  readonly fit?: 'cover' | 'contain';
  readonly empty?: string;
}

/**
 * A capture's frame. While the image loads the frame shows a placeholder; when it arrives, a wrapper around the
 * image fades in once. The image itself never gets a filter, blend mode or lasting opacity, and a thumbnail that was
 * already on hand appears with no animation at all.
 */
export function CaptureFrame({ loader, preview, priority, live = true, fit = 'cover', empty = 'No preview' }: CaptureFrameProps) {
  const ui = useProjectsUi();
  const state = useThumbnail(loader, live ? preview : undefined, priority);
  const arrivedWith = useRef(state.status);
  if (!preview) return h('span', { className: 'hqp-frame hqp-frame-empty', 'aria-hidden': true }, h('span', { className: 'hqp-frame-note' }, empty));
  if (state.status === 'ready') {
    return h('span', { className: `hqp-frame hqp-frame-${fit}`, 'data-digest': preview.digest },
      h('span', { className: `hqp-reveal${arrivedWith.current === 'ready' ? '' : ' hq-enter-fade'}`, 'data-hq-content': 'captured' },
        h('img', { className: 'hqp-thumb', src: state.value, alt: '', decoding: 'async', draggable: false,
          ...(preview.w && preview.h ? { width: preview.w, height: preview.h } : {}) })));
  }
  return h('span', { className: `hqp-frame hqp-frame-${state.status}`, 'aria-hidden': true, 'data-digest': preview.digest },
    state.status === 'error' ? h('span', { className: 'hqp-frame-note' }, 'Preview unavailable') : h(ui.Skeleton, { shape: 'block', className: 'hqp-skeleton' }));
}
