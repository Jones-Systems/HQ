import type { Sha256Hex } from './contract.ts';

/** WebCrypto SHA-256 for renderer-side fakes; the main process uses node:crypto. */
export const webCryptoSha256: Sha256Hex = async (bytes) => {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};
