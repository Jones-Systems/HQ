import type { ReactNode } from 'react';
import type { Appearance, DomainId } from '@hq/contracts';

/** 24×24 stroke glyphs for shell chrome; colour comes from `currentColor`. */
const GLYPHS: Record<DomainId | 'settings' | 'chevron' | 'separator' | 'back', ReactNode> = {
  design: <><path d="M8.5 3.5v17M15.5 3.5v17M3.5 8.5h17M3.5 15.5h17" /></>,
  social: <><circle cx="12" cy="12" r="2" /><path d="M8.6 8.6a4.8 4.8 0 0 0 0 6.8M15.4 8.6a4.8 4.8 0 0 1 0 6.8M5.8 5.8a8.8 8.8 0 0 0 0 12.4M18.2 5.8a8.8 8.8 0 0 1 0 12.4" /></>,
  work: <><rect x="3.5" y="4" width="4.6" height="11" rx="1.3" /><rect x="9.7" y="4" width="4.6" height="16" rx="1.3" /><rect x="15.9" y="4" width="4.6" height="7.5" rx="1.3" /></>,
  wiki: <><path d="M12 6c-2.6-1.7-5.4-2-8.5-1.2v14c3.1-.8 5.9-.5 8.5 1.2 2.6-1.7 5.4-2 8.5-1.2v-14C17.4 4 14.6 4.3 12 6Z" /><path d="M12 6v14" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5" /></>,
  chevron: <path d="m7 10 5 5 5-5" />,
  separator: <path d="m9.5 6 6 6-6 6" />,
  back: <path d="m14.5 6-6 6 6 6" />,
};

const APPEARANCE: Record<Appearance, ReactNode> = {
  light: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></>,
  dark: <path d="M20 14.2A8.5 8.5 0 0 1 9.8 4a8.5 8.5 0 1 0 10.2 10.2Z" />,
  system: <><rect x="3" y="4" width="18" height="12.5" rx="2" /><path d="M8.5 20.5h7M12 16.5v4" /></>,
};

export function ShellIcon({ name, className }: { readonly name: keyof typeof GLYPHS; readonly className?: string }) {
  return <svg className={className ?? 'shell-icon'} viewBox="0 0 24 24" aria-hidden="true">{GLYPHS[name]}</svg>;
}

export function AppearanceIcon({ appearance, className }: { readonly appearance: Appearance; readonly className?: string }) {
  return <svg className={className ?? 'shell-icon'} viewBox="0 0 24 24" aria-hidden="true">{APPEARANCE[appearance]}</svg>;
}
