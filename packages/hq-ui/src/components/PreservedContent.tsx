import { useLayoutEffect, useRef, type HTMLAttributes, type ReactNode } from 'react';
import { HQ_CONTENT_SCHEME_PROPERTY } from '../tokens';

/** RS-2 marker for preserved content: captured screenshots, producer previews and exports. */
export const PRESERVED_CONTENT_ATTRIBUTE = 'data-hq-content';
export const PRESERVED_CONTENT_KINDS = ['captured', 'producer', 'export'] as const;
export type PreservedContentKind = (typeof PRESERVED_CONTENT_KINDS)[number];
export const CONTENT_SCHEMES = ['light', 'dark'] as const;
export type ContentScheme = (typeof CONTENT_SCHEMES)[number];

/**
 * Pin a well's `--hq-content-scheme` to the content's recorded scheme. Uses CSSOM because the app CSP
 * (`style-src 'self'`) blocks inline style attributes. T2's Chromium probe found that an embedded iframe's
 * `prefers-color-scheme` and an SVG used as `<img>` follow the owner element's used `color-scheme`, so an
 * unpinned well would be re-themed by HQ's appearance. Throws on anything but `light` or `dark`.
 */
export function setContentScheme(element: HTMLElement, scheme: ContentScheme): void {
  if (!CONTENT_SCHEMES.includes(scheme)) throw new Error(`recorded content scheme must be light or dark, got ${String(scheme)}`);
  element.style.setProperty(HQ_CONTENT_SCHEME_PROPERTY, scheme);
}

export interface PreservedContentProps extends Omit<HTMLAttributes<HTMLDivElement>, 'style' | 'children'> {
  readonly kind: PreservedContentKind;
  /** The theme the content was captured, produced or exported in — never the current chrome theme. */
  readonly recordedScheme: ContentScheme;
  /** A fixed transparency grid instead of the plain artwork matte. */
  readonly matte?: 'checker';
  readonly children: ReactNode;
}

/**
 * RS-2 well. Chrome tokens, filters, blend modes and opacity never reach its content; the token CSS gives it
 * the constant artwork matte. There is deliberately no `style` prop.
 */
export function PreservedContent({ kind, recordedScheme, matte, children, ...rest }: PreservedContentProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Layout effect: pinned before the browser paints, so a preview never flashes in the chrome scheme.
  useLayoutEffect(() => {
    if (ref.current) setContentScheme(ref.current, recordedScheme);
  }, [recordedScheme]);
  return (
    <div {...rest} ref={ref} data-hq-content={kind} data-hq-matte={matte} data-hq-recorded-scheme={recordedScheme}>
      {children}
    </div>
  );
}
