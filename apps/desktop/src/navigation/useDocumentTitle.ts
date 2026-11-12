import { useEffect } from 'react';
import type { DomainId } from '@hq/contracts';
import { DOMAIN_LABELS } from '../domain-metadata';

export interface DocumentTitleState {
  readonly domain: DomainId;
  readonly settingsOpen: boolean;
}

/** `Settings — HQ` while Settings is open, otherwise `<Domain> — HQ`. */
export function documentTitle({ domain, settingsOpen }: DocumentTitleState): string {
  return `${settingsOpen ? 'Settings' : DOMAIN_LABELS[domain]} — HQ`;
}

/** Keeps the window title on the current location, for the OS window switcher and screen readers. */
export function useDocumentTitle({ domain, settingsOpen }: DocumentTitleState): void {
  useEffect(() => { document.title = documentTitle({ domain, settingsOpen }); }, [domain, settingsOpen]);
}
