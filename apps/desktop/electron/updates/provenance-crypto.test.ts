import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { bundleFromJSON } from '@sigstore/bundle';
import { crypto, X509Certificate } from '@sigstore/core';
import { Verifier, toSignedEntity, type TrustMaterial } from '@sigstore/verify';
import { verifyCertificateClaims, verifyProvenance } from './provenance.js';
import { manifest } from './fixtures.test-support.js';

const fixtureRoot = new URL('./fixtures/sigstore-verify-4.1.2/', import.meta.url);
const bundleJSON = JSON.parse(readFileSync(new URL('bundle.json', fixtureRoot), 'utf8'));
interface TimeRange { start?: string | null; end?: string | null }
interface CertificateAuthority { certChain: { certificates: { rawBytes: string }[] }; validFor?: TimeRange }
interface LogAuthority { baseUrl: string; logId: { keyId: string }; publicKey: { rawBytes: string; keyDetails: string; validFor?: TimeRange } }
const trustedRootJSON = JSON.parse(readFileSync(new URL('trusted-root.json', fixtureRoot), 'utf8')) as {
  certificateAuthorities: CertificateAuthority[]; timestampAuthorities: CertificateAuthority[];
  tlogs: LogAuthority[]; ctlogs: LogAuthority[];
};
const validity = (value?: TimeRange) => ({ start: value?.start ? new Date(value.start) : new Date(0), end: value?.end ? new Date(value.end) : new Date(8640000000000000) });
function trust(): TrustMaterial {
  const certificate = (value: CertificateAuthority) => ({ certChain: value.certChain.certificates.map(cert => X509Certificate.parse(Buffer.from(cert.rawBytes, 'base64'))), validFor: validity(value.validFor) });
  const log = (value: LogAuthority) => ({
    baseURL: value.baseUrl, logID: Buffer.from(value.logId.keyId, 'base64'),
    publicKey: crypto.createPublicKey(Buffer.from(value.publicKey.rawBytes, 'base64'), value.publicKey.keyDetails === 'PKCS1_RSA_PKCS1V5' ? 'pkcs1' : 'spki'),
    validFor: validity(value.publicKey.validFor),
  });
  return {
    certificateAuthorities: trustedRootJSON.certificateAuthorities.map(certificate),
    timestampAuthorities: trustedRootJSON.timestampAuthorities.map(certificate),
    tlogs: trustedRootJSON.tlogs.map(log), ctlogs: trustedRootJSON.ctlogs.map(log),
    publicKey: () => { throw Error('This fixture requires a signing certificate.'); },
  };
}

it('cryptographically verifies the pinned upstream DSSE fixture with default CT, log and timestamp requirements', () => {
  const entity = toSignedEntity(bundleFromJSON(bundleJSON));
  const signer = new Verifier(trust()).verify(entity, { extensions: { issuer: 'https://github.com/login/oauth' } });
  expect(signer.identity?.subjectAlternativeName).toBe('brian@dehamer.com');
  expect(signer.key.type).toBe('public');
});
it('rejects changed signed bytes and missing required transparency or timestamp evidence', () => {
  const changed = structuredClone(bundleJSON);
  changed.dsseEnvelope.payload = Buffer.from('changed payload').toString('base64');
  expect(() => new Verifier(trust()).verify(toSignedEntity(bundleFromJSON(changed)))).toThrow();
  const noLogs = toSignedEntity(bundleFromJSON(bundleJSON)); noLogs.tlogEntries = [];
  expect(() => new Verifier(trust()).verify(noLogs)).toThrow();
  const noTime = toSignedEntity(bundleFromJSON(bundleJSON)); noTime.timestamps = [];
  expect(() => new Verifier(trust()).verify(noTime)).toThrow();
  expect(() => new Verifier({ ...trust(), ctlogs: [] }).verify(toSignedEntity(bundleFromJSON(bundleJSON)))).toThrow();
});
it('keeps the upstream signer and text payload outside HQ production provenance acceptance', async () => {
  const entity = toSignedEntity(bundleFromJSON(bundleJSON));
  expect(entity.key.$case).toBe('certificate');
  if (entity.key.$case !== 'certificate') throw Error('Expected the fixed certificate fixture.');
  expect(() => verifyCertificateClaims(entity.key.certificate, manifest())).toThrow('provenance');
  await expect(verifyProvenance({ bundle: bundleJSON, manifest: manifest(), archiveHash: manifest().archive.sha256, manifestHash: 'f'.repeat(64), cachePath: '/not-used', signal: new AbortController().signal })).rejects.toMatchObject({ code: 'provenance' });
});
