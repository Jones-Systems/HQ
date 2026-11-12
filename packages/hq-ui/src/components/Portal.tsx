import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Mounts window overlays outside their view's clipping and stacking contexts. */
export function Portal({ children }: { readonly children?: ReactNode }) {
  return typeof document === 'undefined' ? null : createPortal(children, document.body);
}
