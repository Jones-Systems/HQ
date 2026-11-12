import type { ReactNode } from 'react';

/** 16px outline icons, 1.5 stroke, `currentColor`. Drawn as SVG so they never depend on a host font. */
function Icon({ children }: { children: ReactNode }) {
  return <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{children}</svg>;
}

export const UndoIcon = () => <Icon><path d="M6 3 3 5.8 6 8.6" /><path d="M3.4 5.8h5.3a3.6 3.6 0 0 1 0 7.2H6.5" /></Icon>;
export const RedoIcon = () => <Icon><path d="m10 3 3 2.8-3 2.8" /><path d="M12.6 5.8H7.3a3.6 3.6 0 0 0 0 7.2h2.2" /></Icon>;
export const AddItemIcon = () => <Icon><rect x="2.5" y="2.5" width="11" height="11" rx="2" /><path d="M8 5.5v5M5.5 8h5" /></Icon>;
export const AddArtboardIcon = () => <Icon><path d="M5.5 2v12M10.5 2v12M2 5.5h12M2 10.5h12" /></Icon>;
export const ZoomOutIcon = () => <Icon><circle cx="7" cy="7" r="4.5" /><path d="M10.4 10.4 13.5 13.5M5 7h4" /></Icon>;
export const ZoomInIcon = () => <Icon><circle cx="7" cy="7" r="4.5" /><path d="M10.4 10.4 13.5 13.5M5 7h4M7 5v4" /></Icon>;
const corners = <path d="M2.5 5.5v-2a1 1 0 0 1 1-1h2M10.5 2.5h2a1 1 0 0 1 1 1v2M13.5 10.5v2a1 1 0 0 1-1 1h-2M5.5 13.5h-2a1 1 0 0 1-1-1v-2" />;
export const FitAllIcon = () => <Icon>{corners}</Icon>;
export const FitSelectionIcon = () => <Icon>{corners}<rect x="5.5" y="5.5" width="5" height="5" rx="1" /></Icon>;
