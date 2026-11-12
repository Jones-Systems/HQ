import type { ReactNode } from 'react';
import { Dialog } from '@hq/ui';

export const SHEET_BREAKPOINT = 720;

export interface DetailSheetProps {
  readonly children: ReactNode;
  readonly label: string;
  readonly onClose: () => void;
}

/** Narrow detail uses the shared modal's focus trap, Escape, scrim and focus restoration. */
export function DetailSheet({ children, label, onClose }: DetailSheetProps) {
  return <Dialog open onClose={onClose} title={label} className="work-ui wd-sheet hq-enter-slide-end">
    {children}
  </Dialog>;
}
