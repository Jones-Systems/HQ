import { useCallback } from 'react';
import { cx } from '../components/cx';

export type SkeletonShape = 'text' | 'block' | 'circle';

export interface SkeletonProps {
  /** `text` is a 10px line; `block` fills a card-sized area; `circle` is an avatar or glyph. Default `text`. */
  readonly shape?: SkeletonShape;
  /** Repeats `text` lines; the last line is shorter so a paragraph reads naturally. Default 1. */
  readonly lines?: number;
  /** Any CSS length, applied through CSSOM because the CSP blocks inline styles. */
  readonly width?: string;
  readonly height?: string;
  readonly className?: string;
}

/**
 * Placeholder with a gentle sheen (static under reduced motion). Skeletons are hidden from assistive technology:
 * mark the loading region with `aria-busy="true"` and keep a visible or polite status such as "Loading cards…".
 */
export function Skeleton({ shape = 'text', lines = 1, width, height, className }: SkeletonProps) {
  const size = useCallback((element: HTMLElement | null) => {
    if (!element) return;
    if (width) element.style.setProperty('--hq-skeleton-w', width); else element.style.removeProperty('--hq-skeleton-w');
    if (height) element.style.setProperty('--hq-skeleton-h', height); else element.style.removeProperty('--hq-skeleton-h');
  }, [width, height]);
  if (shape === 'text' && lines > 1) {
    return (
      <span className={cx('hq-skeleton-lines', className)} aria-hidden="true" ref={size}>
        {Array.from({ length: lines }, (_, index) => (
          <span key={index} className={cx('hq-skeleton', 'hq-skeleton--text', index === lines - 1 && 'hq-skeleton--last')} />
        ))}
      </span>
    );
  }
  return <span className={cx('hq-skeleton', `hq-skeleton--${shape}`, className)} aria-hidden="true" ref={size} />;
}
