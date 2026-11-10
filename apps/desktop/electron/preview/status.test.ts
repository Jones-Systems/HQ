import { expect, it } from 'vitest';
import { PREVIEW_HOST_ENABLED, PREVIEW_PICK_QUALIFIED, previewPlatformQualified } from './status';

it.each(['darwin', 'linux', 'win32', 'freebsd', 'openbsd', 'sunos', 'aix'] as const)(
  'qualifies previews only on the accepted Mac platform (%s)', platform => {
    expect(previewPlatformQualified(platform)).toBe(platform === 'darwin');
  },
);

it('uses the platform qualification for the host and coherent picks', () => {
  expect(PREVIEW_HOST_ENABLED).toBe(process.platform === 'darwin');
  expect(PREVIEW_PICK_QUALIFIED).toBe(process.platform === 'darwin');
});
