import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, rename, rm, statfs } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, relative, sep } from 'node:path';
import type { InstallationRecord, PreparedCandidate, UpdatePreferences } from '@hq/contracts/updates';
import { UpdateFailure, checkAbort, contract, isCandidateRetained } from './contract.js';
import { contentLength, requestOK, type Transport } from './transport.js';
import { extractArchive, type BundleVerifier } from './archive.js';
import type { DiscoveredCandidate } from './discovery.js';
import type { ProvenanceVerifier } from './provenance.js';

export interface SavedState {
  readonly schemaVersion: 1;
  readonly preferences: UpdatePreferences;
  readonly lastCheckedAt: string | null;
  readonly candidate: DiscoveredCandidate | null;
  readonly prepared: PreparedCandidate | null;
  readonly scheduled: boolean;
}
export interface UpdateStorage {
  readonly trustCache: string;
  initialize(): Promise<void>;
  read(): Promise<unknown>;
  write(state: SavedState): Promise<void>;
  prepare(candidate: DiscoveredCandidate, signal: AbortSignal, progress: (received: number) => void, verifying: () => void): Promise<PreparedCandidate>;
  validatePrepared(prepared: PreparedCandidate, candidate: DiscoveredCandidate, signal: AbortSignal): Promise<void>;
  discard(prepared: PreparedCandidate): Promise<void>;
}

const within = (parent: string, child: string): boolean => {
  const value = relative(parent, child);
  return value === '' || !isAbsolute(value) && value !== '..' && !value.startsWith(`..${sep}`);
};

export function createUpdateStorage(record: InstallationRecord, transport: Transport, verify: ProvenanceVerifier, verifyBundle: BundleVerifier): UpdateStorage {
  return createStorage(record.stateRoot, [record.userData, record.sessionData, record.targetPath], transport, verify, verifyBundle);
}

export function createReleaseStorage(stateRoot: string, transport: Transport, verify: ProvenanceVerifier, verifyBundle: BundleVerifier): UpdateStorage {
  return createStorage(stateRoot, [], transport, verify, verifyBundle);
}

function createStorage(root: string, excluded: readonly string[], transport: Transport, verify: ProvenanceVerifier, verifyBundle: BundleVerifier): UpdateStorage {
  const cache = join(root, 'download-cache'), trustCache = join(root, 'trust-cache');
  const candidateRoot = (id: string): string => {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new UpdateFailure('invalid');
    return join(cache, id);
  };
  const preparedPath = (id: string): string => join(candidateRoot(id), 'extracted', 'HQ.app');
  async function validatePrepared(prepared: PreparedCandidate, candidate: DiscoveredCandidate, signal: AbortSignal): Promise<void> {
    if (prepared.candidateId !== candidate.candidateId || prepared.bundlePath !== preparedPath(candidate.candidateId) || contract.candidateId(candidate.manifest) !== candidate.candidateId || contract.candidateId(prepared.manifest as DiscoveredCandidate['manifest']) !== candidate.candidateId) throw new UpdateFailure('integrity');
    for (const path of [candidateRoot(candidate.candidateId), join(candidateRoot(candidate.candidateId), 'extracted'), prepared.bundlePath]) {
      const stat = await lstat(path);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new UpdateFailure('integrity');
    }
    const archive = join(candidateRoot(candidate.candidateId), 'archive.zip'), stat = await lstat(archive);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== candidate.manifest.archive.size) throw new UpdateFailure('integrity');
    const digest = createHash('sha256');
    let received = 0;
    for await (const bytes of createReadStream(archive, { signal })) {
      checkAbort(signal);
      received += bytes.length;
      if (received > candidate.manifest.archive.size) throw new UpdateFailure('integrity');
      digest.update(bytes);
    }
    const archiveHash = digest.digest('hex');
    if (received !== candidate.manifest.archive.size || archiveHash !== candidate.manifest.archive.sha256) throw new UpdateFailure('integrity');
    await verify({ ...candidate, archiveHash, cachePath: trustCache, signal });
    await verifyBundle(prepared.bundlePath, candidate.manifest, signal);
  }
  return {
    trustCache,
    async initialize() {
      if (!isAbsolute(root) || root === parse(root).root || excluded.some(path => within(root, path) || within(path, root))) throw new UpdateFailure('permission');
      for (let current = root; current !== parse(current).root; current = dirname(current)) {
        try { const stat = await lstat(current); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new UpdateFailure('permission'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
      await mkdir(root, { recursive: true, mode: 0o700 });
      const stat = await lstat(root);
      if (process.getuid && stat.uid !== process.getuid()) throw new UpdateFailure('permission');
      await mkdir(cache, { mode: 0o700, recursive: true });
      await mkdir(trustCache, { mode: 0o700, recursive: true });
      for (const owned of [cache, trustCache]) if ((await lstat(owned)).isSymbolicLink()) throw new UpdateFailure('permission');
    },
    async read() {
      try {
        return await contract.readJson(join(root, 'discovery.json'), { maxBytes: 3 * 1024 * 1024 });
      } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    },
    async write(state) { await contract.atomicWrite(join(root, 'discovery.json'), state); },
    validatePrepared,
    async discard(prepared) {
      if (prepared.bundlePath !== preparedPath(prepared.candidateId)) throw new UpdateFailure('integrity');
      if (await isCandidateRetained(root, prepared.candidateId)) return;
      await rm(candidateRoot(prepared.candidateId), { recursive: true, force: true });
    },
    async prepare(candidate, signal, progress, verifying) {
      checkAbort(signal);
      const existing: PreparedCandidate = { schemaVersion: 1, candidateId: candidate.candidateId, manifest: candidate.manifest, bundlePath: preparedPath(candidate.candidateId) };
      let present = false;
      try { await lstat(candidateRoot(candidate.candidateId)); present = true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (present) { verifying(); await validatePrepared(existing, candidate, signal); return existing; }
      const manifest = candidate.manifest, fs = await statfs(cache, { bigint: true });
      const available = fs.bavail * fs.bsize, budget = BigInt(manifest.archive.size) + BigInt(manifest.archive.expandedSize) * 2n + 64n * 1024n * 1024n;
      if (available < budget) throw new UpdateFailure('space');
      const temporary = await mkdtemp(join(cache, 'download-'));
      let retained = false, completed = false;
      try {
        const archive = join(temporary, 'archive.zip'), file = await open(archive, 'wx', 0o600);
        let received = 0;
        const digest = createHash('sha256');
        try {
          const response = await requestOK(transport, new URL(candidate.archiveURL), signal);
          try {
            contentLength(response, contract.MAX_ARCHIVE_BYTES, manifest.archive.size);
            for await (const bytes of response.body) {
              checkAbort(signal);
              received += bytes.byteLength;
              if (received > manifest.archive.size) throw new UpdateFailure('integrity');
              digest.update(bytes);
              await file.writeFile(bytes);
              progress(received);
            }
            checkAbort(signal);
            if (received !== manifest.archive.size) throw new UpdateFailure('integrity');
            await file.sync();
          } finally { response.close(); }
        } finally { await file.close(); }
        const archiveHash = digest.digest('hex');
        if (archiveHash !== manifest.archive.sha256) throw new UpdateFailure('integrity');
        verifying();
        await verify({ ...candidate, archiveHash, cachePath: trustCache, signal });
        const extracted = await extractArchive(archive, join(temporary, 'extracted'), manifest, signal);
        await verifyBundle(extracted, manifest, signal);
        checkAbort(signal);
        const directory = await open(temporary, 'r');
        try { await directory.sync(); } finally { await directory.close(); }
        await rename(temporary, candidateRoot(candidate.candidateId));
        retained = true;
        const parent = await open(cache, 'r');
        try { await parent.sync(); } finally { await parent.close(); }
        completed = true;
        return { schemaVersion: 1, candidateId: candidate.candidateId, manifest, bundlePath: preparedPath(candidate.candidateId) };
      } finally { if (!completed) await rm(retained ? candidateRoot(candidate.candidateId) : temporary, { recursive: true, force: true }); }
    },
  };
}
