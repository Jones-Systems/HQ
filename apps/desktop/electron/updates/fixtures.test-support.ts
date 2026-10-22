import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { BuildReceipt, InstallationRecord, UpdateManifest } from '@hq/contracts/updates';
import { API_ROOT, contract, REPOSITORY, REPOSITORY_URL, WORKFLOW } from './contract.js';
import type { DiscoveredCandidate } from './discovery.js';
import type { Transfer, Transport } from './transport.js';

export function manifest(overrides: Partial<UpdateManifest> = {}): UpdateManifest {
  return {
    schemaVersion: 1, product: 'hq', version: '0.2.0', buildSequence: 2,
    sourceSha: 'a'.repeat(40), sourceTree: 'b'.repeat(40), channel: 'preview',
    compatibilityEpoch: `hq1-${'c'.repeat(64)}`, electronVersion: '44.9.0', appName: 'HQ',
    bundleId: 'org.jones-systems.hq.local', architecture: 'arm64', repository: REPOSITORY,
    platform: 'darwin', releaseTag: 'hq-desktop-0.2.0', workflow: WORKFLOW, runId: '2', runAttempt: 1,
    event: 'push', publishedAt: '2026-10-22T12:00:00.000Z', signing: 'adhoc',
    archive: { name: 'hq-darwin-arm64.zip', size: 3, sha256: createHash('sha256').update('zip').digest('hex'), expandedSize: 3, fileCount: 1 },
    attestation: 'hq-darwin-arm64.sigstore.json', ...overrides,
  };
}
export function installed(): BuildReceipt {
  const value = manifest();
  return { schemaVersion: 1, product: 'hq', version: '0.1.0', buildSequence: 1, sourceSha: 'd'.repeat(40), sourceTree: 'e'.repeat(40), channel: value.channel, compatibilityEpoch: value.compatibilityEpoch, electronVersion: value.electronVersion, appName: value.appName, bundleId: value.bundleId, architecture: value.architecture };
}
export function installation(root: string): InstallationRecord {
  return { schemaVersion: 1, product: 'hq', installationId: '12345678-1234-4234-8234-123456789abc', targetPath: join(root, 'HQ.app'), stateRoot: join(root, 'updater'), userData: join(root, 'profile'), sessionData: join(root, 'session'), appName: 'HQ', bundleId: 'org.jones-systems.hq.local', channel: 'preview', compatibilityEpoch: installed().compatibilityEpoch, profileCreation: 'forbidden', synthetic: false, installed: installed() };
}
export function candidate(value = manifest()): DiscoveredCandidate {
  return { candidateId: contract.candidateId(value), manifest: value, manifestHash: 'f'.repeat(64), archiveURL: `${REPOSITORY_URL}/releases/download/${value.releaseTag}/${value.archive.name}`, bundle: {} };
}
export function response(bytes: Buffer, headers: Transfer['headers'] = {}, status = 200): Transfer {
  return { status, headers, body: (async function* () { yield bytes; })(), close() {} };
}
export function transport(bytes: Buffer, headers: Transfer['headers'] = {}): Transport { return async () => response(bytes, headers); }

export function publication(value = manifest(), archive = Buffer.from('zip')) {
  const manifestBytes = Buffer.from(JSON.stringify(value)), bundle = Buffer.from(JSON.stringify({ mediaType: 'fixture' }));
  const base = `${REPOSITORY_URL}/releases/download/${value.releaseTag}/`;
  const asset = (name: string, bytes: Buffer) => ({ name, size: bytes.length, digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, browser_download_url: `${base}${name}` });
  const releases = [{ draft: false, prerelease: value.channel === 'preview', tag_name: value.releaseTag, assets: [asset(`hq-darwin-${value.architecture}.json`, manifestBytes), asset(value.archive.name, archive), asset(value.attestation, bundle)] }];
  const repository = { id: REPOSITORY.id, full_name: REPOSITORY.name, owner: { id: REPOSITORY.ownerId }, private: false };
  const run = { repository, head_repository: repository, id: Number(value.runId), run_attempt: value.runAttempt, head_sha: value.sourceSha, path: WORKFLOW, event: 'push', status: 'completed', conclusion: 'success' };
  const get: Transport = async url => {
    const bytes = url.href === API_ROOT ? Buffer.from(JSON.stringify(repository))
      : url.href === `${API_ROOT}/releases?per_page=20` ? Buffer.from(JSON.stringify(releases))
        : url.href === `${API_ROOT}/actions/runs/${value.runId}/attempts/${value.runAttempt}` ? Buffer.from(JSON.stringify(run))
          : url.href === `${base}hq-darwin-${value.architecture}.json` ? manifestBytes
            : url.href === `${base}${value.attestation}` ? bundle
              : url.href === `${base}${value.archive.name}` ? archive : null;
    if (!bytes) throw Error(`Unexpected fixture request: ${url.pathname}`);
    return response(bytes, { 'content-length': String(bytes.length) });
  };
  return { get, releases, repository, run };
}

export function statement(value = manifest()) {
  const ref = `refs/tags/${value.releaseTag}`;
  return {
    _type: 'https://in-toto.io/Statement/v1', predicateType: 'https://slsa.dev/provenance/v1',
    subject: [{ name: value.archive.name, digest: { sha256: value.archive.sha256 } }, { name: 'hq-darwin-arm64.json', digest: { sha256: 'f'.repeat(64) } }],
    predicate: {
      buildDefinition: {
        buildType: 'https://actions.github.io/buildtypes/workflow/v1',
        externalParameters: { workflow: { path: WORKFLOW, repository: REPOSITORY_URL, ref } },
        internalParameters: { github: { event_name: 'push', repository_id: String(REPOSITORY.id), repository_owner_id: String(REPOSITORY.ownerId), runner_environment: 'github-hosted' } },
        resolvedDependencies: [{ uri: `git+${REPOSITORY_URL}@${ref}`, digest: { gitCommit: value.sourceSha } }],
      },
      runDetails: { builder: { id: `${REPOSITORY_URL}/${WORKFLOW}@${ref}` }, metadata: { invocationId: `${REPOSITORY_URL}/actions/runs/${value.runId}/attempts/${value.runAttempt}` } },
    },
  };
}

export function zip(entries: readonly { name: string; content: string; mode?: number }[]): Buffer {
  const locals: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), bytes = Buffer.from(entry.content);
    let crc = 0xffffffff;
    for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1; }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(name.length, 26);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50); header.writeUInt16LE(0x314, 4); header.writeUInt16LE(20, 6); header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(bytes.length, 20); header.writeUInt32LE(bytes.length, 24); header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38); header.writeUInt32LE(offset, 42);
    locals.push(local, name, bytes); central.push(header, name); offset += local.length + name.length + bytes.length;
  }
  const center = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(center.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, center, end]);
}
