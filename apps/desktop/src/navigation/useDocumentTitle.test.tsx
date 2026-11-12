// @vitest-environment happy-dom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DOMAIN_IDS } from '@hq/contracts';
import { documentTitle, useDocumentTitle, type DocumentTitleState } from './useDocumentTitle';

afterEach(() => { cleanup(); document.title = ''; });

describe('documentTitle', () => {
  it('names the domain, or Settings while Settings is open', () => {
    expect(DOMAIN_IDS.map(domain => documentTitle({ domain, settingsOpen: false }))).toEqual(['Design — HQ', 'Social — HQ', 'Work — HQ', 'Wiki — HQ']);
    expect(documentTitle({ domain: 'work', settingsOpen: true })).toBe('Settings — HQ');
  });
});

describe('useDocumentTitle', () => {
  it('tracks the location', () => {
    const { rerender } = renderHook((state: DocumentTitleState) => useDocumentTitle(state), { initialProps: { domain: 'work', settingsOpen: false } as DocumentTitleState });
    expect(document.title).toBe('Work — HQ');
    rerender({ domain: 'work', settingsOpen: true });
    expect(document.title).toBe('Settings — HQ');
    rerender({ domain: 'social', settingsOpen: false });
    expect(document.title).toBe('Social — HQ');
  });
});
