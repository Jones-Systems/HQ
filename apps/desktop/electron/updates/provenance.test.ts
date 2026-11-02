import { expect, it } from 'vitest';
import { ASN1Obj } from '@sigstore/core';
import { certificateClaim, verifyCertificateClaims, verifyProvenance, verifyStatement } from './provenance.js';
import { REPOSITORY, REPOSITORY_URL, WORKFLOW } from './contract.js';
import { manifest, statement } from './fixtures.test-support.js';

function der(tag: number, bytes: Buffer): Buffer {
  const length = bytes.length < 128 ? [bytes.length] : bytes.length < 256 ? [0x81, bytes.length] : [0x82, bytes.length >>> 8, bytes.length & 255];
  return Buffer.concat([Buffer.from([tag, ...length]), bytes]);
}
function extension(suffix: number, value: string, tag = 12): ASN1Obj {
  const oid = der(6, Buffer.from([0x2b, 6, 1, 4, 1, 0x83, 0xbf, 0x30, 1, suffix]));
  return ASN1Obj.parseBuffer(der(0x30, Buffer.concat([oid, der(4, der(tag, Buffer.from(value)))])));
}
function certificate(value = manifest()) {
  const ref = value.signing === 'developer-id' ? 'refs/heads/main' : `refs/tags/${value.releaseTag}`, workflow = `${REPOSITORY_URL}/${WORKFLOW}@${ref}`;
  return { subjectAltName: workflow, extensions: Object.entries({ 9: workflow, 10: value.sourceSha, 11: 'github-hosted', 12: REPOSITORY_URL, 13: value.sourceSha, 14: ref, 15: String(REPOSITORY.id), 17: String(REPOSITORY.ownerId), 21: `${REPOSITORY_URL}/actions/runs/2/attempts/1` }).map(([suffix, text]) => extension(Number(suffix), text)) };
}

it('accepts the exact authenticated statement and compares both signed subjects explicitly', () => {
  const value = manifest();
  expect(() => verifyStatement(statement(), value, value.archive.sha256, 'f'.repeat(64))).not.toThrow();
  expect(() => verifyStatement(statement(), value, '0'.repeat(64), 'f'.repeat(64))).toThrow('provenance');
  expect(() => verifyStatement(statement(), value, value.archive.sha256, '0'.repeat(64))).toThrow('provenance');
});
it('rejects source, workflow, ref, run, attempt, owner, repository, event and predicate mismatches', () => {
  const mutations = [
    (value: ReturnType<typeof statement>) => { value.predicate.buildDefinition.resolvedDependencies[0]!.digest.gitCommit = '0'.repeat(40); },
    (value: ReturnType<typeof statement>) => { value.predicate.buildDefinition.externalParameters.workflow.path = '.github/workflows/other.yml'; },
    (value: ReturnType<typeof statement>) => { value.predicate.buildDefinition.externalParameters.workflow.ref = 'refs/heads/main'; },
    (value: ReturnType<typeof statement>) => { value.predicate.runDetails.metadata.invocationId = `${REPOSITORY_URL}/actions/runs/3/attempts/1`; },
    (value: ReturnType<typeof statement>) => { value.predicate.runDetails.metadata.invocationId = `${REPOSITORY_URL}/actions/runs/2/attempts/2`; },
    (value: ReturnType<typeof statement>) => { value.predicate.buildDefinition.internalParameters.github.repository_owner_id = '1'; },
    (value: ReturnType<typeof statement>) => { value.predicate.buildDefinition.internalParameters.github.repository_id = '1'; },
    (value: ReturnType<typeof statement>) => { value.predicate.buildDefinition.internalParameters.github.event_name = 'pull_request'; },
    (value: ReturnType<typeof statement>) => { value.predicateType = 'https://slsa.dev/provenance/v0.2'; },
    (value: ReturnType<typeof statement>) => { value.subject.push(value.subject[0]!); },
  ];
  for (const mutate of mutations) {
    const value = statement(); mutate(value);
    expect(() => verifyStatement(value, manifest(), manifest().archive.sha256, 'f'.repeat(64))).toThrow('provenance');
  }
});
it('decodes modern Fulcio OIDs as one primitive DER UTF8String and rejects duplicates', () => {
  const value = certificate();
  expect(() => verifyCertificateClaims(value, manifest())).not.toThrow();
  for (const suffix of [9, 10, 11, 12, 13, 14, 15, 17, 21]) {
    const wrong = certificate();
    wrong.extensions = wrong.extensions.filter(ext => ext.subs[0]!.toOID() !== `1.3.6.1.4.1.57264.1.${suffix}`);
    wrong.extensions.push(extension(suffix, 'wrong'));
    expect(() => verifyCertificateClaims(wrong, manifest())).toThrow('provenance');
  }
  expect(() => certificateClaim({ extensions: [extension(15, '1426280211'), extension(15, '1426280211')] }, 15)).toThrow('provenance');
  expect(() => certificateClaim({ extensions: [extension(15, '1426280211', 0x16)] }, 15)).toThrow('provenance');
});
it('rejects an unattested JSON statement without falling back to subject claims', async () => {
  await expect(verifyProvenance({ bundle: statement(), manifest: manifest(), archiveHash: manifest().archive.sha256, manifestHash: 'f'.repeat(64), cachePath: '/not-used', signal: new AbortController().signal })).rejects.toMatchObject({ code: 'provenance' });
});

it('production provenance requires fixed main policy and both subjects even if a manifest names a different ref', () => {
  const signingPolicy = { schemaVersion: 1, mode: 'developer-id', teamId: '2CUPSQS986', identifier: 'org.jones-systems.hq.local', hardenedRuntime: true, secureTimestamp: true, notarized: true, stapled: true } as const;
  const value = manifest({ signing: 'developer-id', signingPolicy, sourceRef: 'refs/heads/main', releaseTag: 'hq-desktop-signed-2' });
  expect(() => verifyCertificateClaims(certificate(value), value)).not.toThrow();
  expect(() => verifyStatement(statement(value), value, value.archive.sha256, 'f'.repeat(64))).not.toThrow();
  for (const ref of ['refs/heads/feature', `refs/tags/${value.releaseTag}`]) {
    const changed = statement(value);
    changed.predicate.buildDefinition.externalParameters.workflow.ref = ref;
    changed.predicate.runDetails.builder.id = `${REPOSITORY_URL}/${WORKFLOW}@${ref}`;
    changed.predicate.buildDefinition.resolvedDependencies[0]!.uri = `git+${REPOSITORY_URL}@${ref}`;
    expect(() => verifyStatement(changed, value, value.archive.sha256, 'f'.repeat(64))).toThrow('provenance');
  }
  for (const changed of [{ ...value, sourceRef: 'refs/heads/feature' }, { ...value, signing: 'adhoc' }, { ...value, sourceSha: '0'.repeat(40) }]) {
    expect(() => verifyCertificateClaims(certificate(value), changed as typeof value)).toThrow('provenance');
    expect(() => verifyStatement(statement(value), changed as typeof value, value.archive.sha256, 'f'.repeat(64))).toThrow('provenance');
  }
  expect(() => verifyStatement(statement(value), value, '0'.repeat(64), 'f'.repeat(64))).toThrow('provenance');
  expect(() => verifyStatement(statement(value), value, value.archive.sha256, '0'.repeat(64))).toThrow('provenance');
});
