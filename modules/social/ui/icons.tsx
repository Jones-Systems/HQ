import type { ReactElement } from 'react';

/**
 * Social's small line icons (16px grid, 1.6 stroke, currentColor). They are decorative: every use sits next to a
 * visible word or an accessible label, so each renders `aria-hidden`.
 */
export type SocialIconName =
  | 'overview' | 'sources' | 'workbenches' | 'library' | 'calendar' | 'runs' | 'channels'
  | 'plus' | 'play' | 'check' | 'close' | 'alert' | 'info' | 'clock' | 'search' | 'chevron-down' | 'chevron-right'
  | 'chevron-left' | 'copy' | 'upload' | 'file' | 'refresh' | 'undo' | 'arrow-right' | 'link' | 'sparkle' | 'brands'
  | 'offline' | 'grip' | 'sliders';

const PATHS: Record<SocialIconName, ReactElement> = {
  overview: <><path d="M3 7.2 8 3l5 4.2V13a.6.6 0 0 1-.6.6H9.6V10H6.4v3.6H3.6A.6.6 0 0 1 3 13Z" /></>,
  sources: <><ellipse cx="8" cy="4" rx="5" ry="1.8" /><path d="M3 4v8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V4" /><path d="M3 8c0 1 2.2 1.8 5 1.8S13 9 13 8" /></>,
  workbenches: <><path d="M6.2 2.5h3.6M6.8 2.5v3.8L3.4 12.2a.9.9 0 0 0 .8 1.3h7.6a.9.9 0 0 0 .8-1.3L9.2 6.3V2.5" /><path d="M4.8 9.6h6.4" /></>,
  library: <><path d="M4 2.5h5.5L12.5 5.5v8H4Z" /><path d="M9.5 2.5v3h3M6 8.5h4.5M6 11h3" /></>,
  calendar: <><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" /><path d="M2.5 6.8h11M5.5 2v3M10.5 2v3" /></>,
  runs: <><circle cx="8" cy="8" r="5.6" /><path d="M8 4.8V8l2.2 1.4" /></>,
  channels: <><circle cx="4" cy="8" r="1.7" /><circle cx="12" cy="4" r="1.7" /><circle cx="12" cy="12" r="1.7" /><path d="m5.5 7.2 5-2.4M5.5 8.8l5 2.4" /></>,
  plus: <><path d="M8 3.5v9M3.5 8h9" /></>,
  play: <><path d="M5 3.6v8.8a.5.5 0 0 0 .76.43l7-4.4a.5.5 0 0 0 0-.86l-7-4.4A.5.5 0 0 0 5 3.6Z" /></>,
  check: <><path d="m3.5 8.4 2.9 2.9 6.1-6.3" /></>,
  close: <><path d="m4.5 4.5 7 7M11.5 4.5l-7 7" /></>,
  alert: <><path d="M8 2.6 14 13H2Z" /><path d="M8 6.6v3M8 11.4v.1" /></>,
  info: <><circle cx="8" cy="8" r="5.6" /><path d="M8 7.4v3.6M8 5.2v.1" /></>,
  clock: <><circle cx="8" cy="8" r="5.6" /><path d="M8 5v3.2l2 1.2" /></>,
  search: <><circle cx="7" cy="7" r="4" /><path d="m10 10 3.2 3.2" /></>,
  'chevron-down': <><path d="m4.5 6.5 3.5 3.5 3.5-3.5" /></>,
  'chevron-right': <><path d="m6.5 4.5 3.5 3.5-3.5 3.5" /></>,
  'chevron-left': <><path d="M9.5 4.5 6 8l3.5 3.5" /></>,
  copy: <><rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1.2" /><path d="M3 10.5V4a1 1 0 0 1 1-1h6.5" /></>,
  upload: <><path d="M8 10.5V3M5 6l3-3 3 3" /><path d="M3 10.5v2a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2" /></>,
  file: <><path d="M4 2.5h5.5L12.5 5.5v8H4Z" /><path d="M9.5 2.5v3h3" /></>,
  refresh: <><path d="M12.8 6.2A5 5 0 1 0 13 9" /><path d="M13 2.8v3.6H9.4" /></>,
  undo: <><path d="M5.5 4 3 6.5 5.5 9" /><path d="M3 6.5h6.2a3.6 3.6 0 0 1 0 7.2H6" /></>,
  'arrow-right': <><path d="M3 8h10M9 4l4 4-4 4" /></>,
  link: <><path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 0 0-3.7-3.7l-.6.6" /><path d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 0 0 3.7 3.7l.6-.6" /></>,
  sparkle: <><path d="M8 2.5 9.3 6.7 13.5 8 9.3 9.3 8 13.5 6.7 9.3 2.5 8 6.7 6.7Z" /></>,
  brands: <><rect x="2.5" y="2.5" width="5" height="5" rx="1.2" /><rect x="8.5" y="2.5" width="5" height="5" rx="1.2" /><rect x="2.5" y="8.5" width="5" height="5" rx="1.2" /><rect x="8.5" y="8.5" width="5" height="5" rx="1.2" /></>,
  offline: <><path d="M2.5 2.5l11 11" /><path d="M5.2 8.6a4 4 0 0 1 2-1M3 6.4a7 7 0 0 1 2.6-1.5M13 6.4a7 7 0 0 0-4.1-1.9M10.9 8.7a4 4 0 0 0-.7-.6M8 12h.01" /></>,
  sliders: <><path d="M2.5 4.5h4M9.5 4.5h4M2.5 11.5h7M12.5 11.5h1" /><circle cx="8" cy="4.5" r="1.5" /><circle cx="11" cy="11.5" r="1.5" /></>,
  grip: <><circle cx="6" cy="4.5" r=".9" /><circle cx="10" cy="4.5" r=".9" /><circle cx="6" cy="8" r=".9" /><circle cx="10" cy="8" r=".9" /><circle cx="6" cy="11.5" r=".9" /><circle cx="10" cy="11.5" r=".9" /></>,
};

export function SocialIcon({ name, className }: { readonly name: SocialIconName; readonly className?: string }) {
  return (
    <svg className={className ? `sx-icon ${className}` : 'sx-icon'} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}
