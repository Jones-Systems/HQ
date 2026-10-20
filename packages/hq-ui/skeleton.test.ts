import { describe, expect, it } from 'vitest';
import { PRESERVED_CONTENT_ATTRIBUTE, PRESERVED_CONTENT_KINDS } from '@hq/ui';

describe('@hq/ui workspace skeleton', () => {
  it('resolves by package name and exposes the RS-2 preserved-content marker', () => {
    expect(PRESERVED_CONTENT_ATTRIBUTE).toBe('data-hq-content');
    expect([...PRESERVED_CONTENT_KINDS]).toEqual(['captured', 'producer', 'export']);
  });
});
