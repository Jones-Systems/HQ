import { ASN1Obj, type X509Certificate } from '@sigstore/core';
import { bundleFromJSON } from '@sigstore/bundle';
import { getTrustedRoot } from '@sigstore/tuf';
import { Verifier, toSignedEntity, toTrustMaterial } from '@sigstore/verify';
import type { UpdateManifest } from '@hq/contracts/updates';
import { REPOSITORY, REPOSITORY_URL, WORKFLOW, UpdateFailure, checkAbort, object } from './contract.js';

const OID = '1.3.6.1.4.1.57264.1.';
function provenanceRef(manifest: UpdateManifest): string {
  if (manifest.signing === 'developer-id') {
    if (!manifest.signingPolicy || manifest.sourceRef !== 'refs/heads/main' || manifest.releaseTag !== `hq-desktop-signed-${manifest.runId}`) throw new UpdateFailure('provenance');
    return 'refs/heads/main';
  }
  if (manifest.signing !== 'adhoc' || manifest.signingPolicy || manifest.sourceRef || manifest.releaseTag.startsWith('hq-desktop-signed-')) throw new UpdateFailure('provenance');
  return `refs/tags/${manifest.releaseTag}`;
}

const ISSUER = 'https://token.actions.githubusercontent.com';

export function certificateClaim(certificate: Pick<X509Certificate, 'extensions'>, suffix: number): string {
  const matches = certificate.extensions.filter(extension => extension.subs[0]?.toOID() === `${OID}${suffix}`);
  if (matches.length !== 1) throw new UpdateFailure('provenance');
  const encoded = matches[0]!.subs.at(-1);
  if (!encoded?.tag.isOctetString() || encoded.tag.constructed) throw new UpdateFailure('provenance');
  const value = ASN1Obj.parseBuffer(Buffer.from(encoded.value));
  if (!value.tag.isUniversal() || value.tag.number !== 12 || value.tag.constructed || value.subs.length !== 0 || !value.toDER().equals(encoded.value)) throw new UpdateFailure('provenance');
  return new TextDecoder('utf-8', { fatal: true }).decode(value.value);
}

export function verifyCertificateClaims(certificate: Pick<X509Certificate, 'extensions' | 'subjectAltName'>, manifest: UpdateManifest): void {
  const ref = provenanceRef(manifest);
  const workflow = `${REPOSITORY_URL}/${WORKFLOW}@${ref}`;
  if (certificate.subjectAltName !== workflow) throw new UpdateFailure('provenance');
  const expected: Readonly<Record<number, string>> = {
    9: workflow, 10: manifest.sourceSha, 11: 'github-hosted', 12: REPOSITORY_URL,
    13: manifest.sourceSha, 14: ref, 15: String(REPOSITORY.id), 17: String(REPOSITORY.ownerId),
    21: `${REPOSITORY_URL}/actions/runs/${manifest.runId}/attempts/${manifest.runAttempt}`,
  };
  for (const [suffix, value] of Object.entries(expected)) if (certificateClaim(certificate, Number(suffix)) !== value) throw new UpdateFailure('provenance');
}

export function verifyStatement(statement: unknown, manifest: UpdateManifest, archiveHash: string, manifestHash: string): void {
  if (archiveHash !== manifest.archive.sha256) throw new UpdateFailure('provenance');
  if (!object(statement) || statement._type !== 'https://in-toto.io/Statement/v1' || statement.predicateType !== 'https://slsa.dev/provenance/v1' || !Array.isArray(statement.subject) || statement.subject.length > 16) throw new UpdateFailure('provenance');
  for (const [name, digest] of [[manifest.archive.name, archiveHash], [`hq-darwin-${manifest.architecture}.json`, manifestHash]]) {
    const subjects = statement.subject.filter(subject => object(subject) && subject.name === name);
    if (subjects.length !== 1 || !object(subjects[0]!.digest) || subjects[0]!.digest.sha256 !== digest) throw new UpdateFailure('provenance');
  }
  const predicate = statement.predicate;
  if (!object(predicate) || !object(predicate.buildDefinition) || !object(predicate.runDetails)) throw new UpdateFailure('provenance');
  const build = predicate.buildDefinition, run = predicate.runDetails;
  if (build.buildType !== 'https://actions.github.io/buildtypes/workflow/v1' || !object(build.externalParameters) || !object(build.externalParameters.workflow) || !object(build.internalParameters) || !object(build.internalParameters.github) || !Array.isArray(build.resolvedDependencies)) throw new UpdateFailure('provenance');
  const ref = provenanceRef(manifest), workflow = build.externalParameters.workflow, github = build.internalParameters.github;
  if (workflow.path !== WORKFLOW || workflow.repository !== REPOSITORY_URL || workflow.ref !== ref || github.event_name !== 'push' || github.repository_id !== String(REPOSITORY.id) || github.repository_owner_id !== String(REPOSITORY.ownerId) || github.runner_environment !== 'github-hosted') throw new UpdateFailure('provenance');
  if (!object(run.metadata) || run.metadata.invocationId !== `${REPOSITORY_URL}/actions/runs/${manifest.runId}/attempts/${manifest.runAttempt}` || !object(run.builder) || run.builder.id !== `${REPOSITORY_URL}/${WORKFLOW}@${ref}`) throw new UpdateFailure('provenance');
  const sources = build.resolvedDependencies.filter(source => object(source) && source.uri === `git+${REPOSITORY_URL}@${ref}`);
  if (sources.length !== 1 || !object(sources[0]!.digest) || sources[0]!.digest.gitCommit !== manifest.sourceSha) throw new UpdateFailure('provenance');
}

export interface ProvenanceInput {
  readonly bundle: unknown;
  readonly manifest: UpdateManifest;
  readonly archiveHash: string;
  readonly manifestHash: string;
  readonly cachePath: string;
  readonly signal: AbortSignal;
}
export type ProvenanceVerifier = (input: ProvenanceInput) => Promise<void>;

export const verifyProvenance: ProvenanceVerifier = async input => {
  checkAbort(input.signal);
  try {
    const bundle = bundleFromJSON(input.bundle);
    if (bundle.content.$case !== 'dsseEnvelope' || bundle.content.dsseEnvelope.payloadType !== 'application/vnd.in-toto+json') throw new UpdateFailure('provenance');
    const entity = toSignedEntity(bundle);
    if (entity.key.$case !== 'certificate') throw new UpdateFailure('provenance');
    const root = await getTrustedRoot({ cachePath: input.cachePath, mirrorURL: 'https://tuf-repo-cdn.sigstore.dev', forceCache: false, retry: 1, timeout: 5000 });
    checkAbort(input.signal);
    new Verifier(toTrustMaterial(root)).verify(entity, { extensions: { issuer: ISSUER } });
    verifyCertificateClaims(entity.key.certificate, input.manifest);
    // DSSE verification authenticates its payload, but does not compare an artifact to the in-toto subject.
    verifyStatement(JSON.parse(Buffer.from(bundle.content.dsseEnvelope.payload).toString('utf8')), input.manifest, input.archiveHash, input.manifestHash);
    checkAbort(input.signal);
  } catch (error) {
    checkAbort(input.signal);
    if (error instanceof UpdateFailure) throw error;
    throw new UpdateFailure('provenance');
  }
};
