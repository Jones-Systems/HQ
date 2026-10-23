import { expect, it, vi } from 'vitest';
import { credentialCodec } from './credentials';
it('uses macOS native encryption without invoking the Linux-only backend method', () => {
  const backend = vi.fn(() => { throw Error('Linux-only method'); });
  const codec = credentialCodec({ isEncryptionAvailable: () => true, getSelectedStorageBackend: backend, encryptString: value => Buffer.from(`encrypted:${value}`), decryptString: value => value.toString().slice(10) }, 'darwin');
  expect(codec.decode(codec.encode('synthetic'))).toBe('synthetic'); expect(backend).not.toHaveBeenCalled();
});
it.each(['basic_text', 'unknown', undefined])('refuses an unprotected Linux backend %s', backend => {
  const encryptString = vi.fn(); const codec = credentialCodec({ isEncryptionAvailable: () => true, ...(backend ? { getSelectedStorageBackend: () => backend } : {}), encryptString, decryptString: () => '' }, 'linux');
  expect(() => codec.encode('synthetic')).toThrow('Protected storage unavailable'); expect(encryptString).not.toHaveBeenCalled();
});
it('fails closed when native encryption is unavailable', () => {
  const codec = credentialCodec({ isEncryptionAvailable: () => false, encryptString: Buffer.from, decryptString: () => '' }, 'darwin');
  expect(() => codec.decode(Buffer.from('synthetic'))).toThrow();
});
