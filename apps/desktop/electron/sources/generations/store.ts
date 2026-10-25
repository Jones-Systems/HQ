import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { keys, record } from '../../services.js';
import { canonicalJson, equalBytes, parseCanonicalJson, sha256 } from './canonical-json.js';
import { counter, digest, opaque } from './paths.js';
import { GenerationError, requireGeneration } from './types.js';
import type { GenerationBinding, GenerationFile, GenerationIdentity, GenerationManifest } from './types.js';
import { GENERATION_LIMITS, refFor, validateBinding, validateManifest, validateRef } from './wire.js';

interface StoredPointer { schema: 'hq-generation-pointer/v1'; binding: GenerationBinding; generation: GenerationIdentity }
export interface PointerSnapshot { bytes: Uint8Array | null; pointer: StoredPointer | null }
export type StoreWriteKind = 'blob' | 'manifest' | 'pointer';
// Constructor-only seams let storage tests stop writes at the actual durability
// boundary. The public consumer does not accept or forward these hooks.
export interface StoreHooks {
  beforeRename?(kind: StoreWriteKind): Promise<void>;
  afterRename?(kind: StoreWriteKind): Promise<void>;
}

const promotions = new Map<string, Promise<void>>();
async function withPromotion<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = promotions.get(key) ?? Promise.resolve();
  let release: () => void = () => {};
  const next = new Promise<void>(done => { release = done; });
  promotions.set(key, next);
  await previous;
  try { return await action(); }
  finally { release(); if (promotions.get(key) === next) promotions.delete(key); }
}
function missing(error: unknown): boolean { return record(error) ? error.code === 'ENOENT' : (error as NodeJS.ErrnoException)?.code === 'ENOENT'; }

export class GenerationStore {
  private poisoned = false;
  readonly root: string;
  constructor(root: string, private readonly hooks: StoreHooks = {}) {
    if (typeof root !== 'string' || !isAbsolute(root) || root.includes('\0') || resolve(root) !== root || root === parse(root).root)
      throw new TypeError('Generation store root must be a canonical absolute directory');
    this.root = root;
  }
  get uncertain(): boolean { return this.poisoned; }
  private check(): void { requireGeneration(!this.poisoned, 'store_uncertain'); }
  private uid(): number {
    requireGeneration(typeof process.getuid === 'function', 'store_unavailable');
    return process.getuid();
  }
  private async directory(path: string): Promise<void> {
    let created = false;
    try { await fs.mkdir(path, { mode: 0o700 }); created = true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const info = await fs.lstat(path);
    requireGeneration(info.isDirectory() && !info.isSymbolicLink() && info.uid === this.uid() && (info.mode & 0o7777) === 0o700, 'store_unavailable');
    if (created) await this.syncDirectory(dirname(path));
  }
  private async prepare(): Promise<void> {
    this.check();
    // Existing ancestors may be public directories; no component may be a link.
    let current = parse(this.root).root;
    for (const part of this.root.slice(current.length).split('/')) {
      current = join(current, part);
      let info;
      try { info = await fs.lstat(current); }
      catch (error) {
        if (!missing(error)) throw error;
        await this.directory(current); info = await fs.lstat(current);
      }
      requireGeneration(info.isDirectory() && !info.isSymbolicLink(), 'store_unavailable');
    }
    await this.directory(this.root);
    for (const name of ['blobs', 'manifests', 'roots', 'staging']) await this.directory(join(this.root, name));
  }
  private async syncDirectory(path: string): Promise<void> {
    const handle = await fs.open(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_DIRECTORY);
    try { await handle.sync(); } finally { await handle.close(); }
  }
  private async bytes(path: string, maximum: number, oversized: 'store_unavailable' | 'blob_mismatch' = 'store_unavailable'): Promise<Uint8Array> {
    const handle = await fs.open(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const info = await handle.stat();
      requireGeneration(info.isFile() && info.uid === this.uid() && (info.mode & 0o7777) === 0o600, 'store_unavailable');
      requireGeneration(info.size <= maximum, oversized);
      // A bounded read also protects against a file growing after fstat.
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const buffer = new Uint8Array(Math.min(64 * 1024, maximum - total + 1));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
        if (!bytesRead) break;
        total += bytesRead;
        requireGeneration(total <= maximum, oversized);
        chunks.push(buffer.subarray(0, bytesRead));
      }
      const data = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
      return data;
    } finally { await handle.close(); }
  }
  private fail(error: unknown): never {
    if (this.poisoned) throw new GenerationError('store_uncertain');
    if (error instanceof GenerationError) throw error;
    throw new GenerationError('store_unavailable');
  }
  private async atomic(path: string, bytes: Uint8Array, checksum: string, kind: StoreWriteKind): Promise<void> {
    this.check();
    const temporary = join(this.root, 'staging', randomUUID() + '.tmp');
    let created = false, renamed = false;
    try {
      const handle = await fs.open(temporary, 'wx', 0o600);
      created = true;
      try { await handle.writeFile(bytes); await handle.sync(); }
      finally { await handle.close(); }
      requireGeneration(sha256(await this.bytes(temporary, bytes.length)) === checksum, 'store_unavailable');
      await this.hooks.beforeRename?.(kind);
      await fs.rename(temporary, path);
      renamed = true;
      await this.hooks.afterRename?.(kind);
      await this.syncDirectory(dirname(path));
      if (dirname(path) !== join(this.root, 'staging')) await this.syncDirectory(join(this.root, 'staging'));
    } catch (error) {
      if (renamed) this.poisoned = true;
      this.fail(error);
    } finally {
      if (created && !renamed) {
        try { await fs.unlink(temporary); }
        catch (error) { if (!missing(error)) this.fail(error); }
      }
    }
  }
  private pointerPath(rootId: string): string { opaque(rootId); return join(this.root, 'roots', rootId + '.json'); }
  private manifestPath(identity: GenerationIdentity): string {
    opaque(identity.rootId); counter(identity.epoch); counter(identity.sequence); digest(identity.manifestSha256);
    return join(this.root, 'manifests', identity.rootId, `${identity.epoch}-${identity.sequence}-${identity.manifestSha256}.json`);
  }
  async snapshot(rootId: string): Promise<PointerSnapshot> {
    try {
      await this.prepare();
      let bytes: Uint8Array;
      try { bytes = await this.bytes(this.pointerPath(rootId), 64 * 1024); }
      catch (error) { if (missing(error)) return { bytes: null, pointer: null }; throw error; }
      const value = parseCanonicalJson(bytes, 64 * 1024);
      requireGeneration(record(value) && keys(value, ['schema', 'binding', 'generation']) && value.schema === 'hq-generation-pointer/v1', 'store_unavailable');
      const binding = validateBinding(value.binding as GenerationBinding);
      const identity = value.generation;
      requireGeneration(record(identity) && keys(identity, ['rootId', 'epoch', 'sequence', 'manifestSha256']), 'store_unavailable');
      opaque(identity.rootId); counter(identity.epoch); counter(identity.sequence); digest(identity.manifestSha256);
      requireGeneration(identity.rootId === rootId && binding.rootId === rootId, 'store_unavailable');
      return { bytes, pointer: { schema: 'hq-generation-pointer/v1', binding, generation: identity as unknown as GenerationIdentity } };
    } catch (error) { this.fail(error); }
  }
  assertBinding(snapshot: PointerSnapshot, binding: GenerationBinding): void {
    if (snapshot.pointer) requireGeneration(equalBytes(canonicalJson(snapshot.pointer.binding), canonicalJson(binding)), 'binding_mismatch');
  }
  async manifest(identity: GenerationIdentity, binding: GenerationBinding): Promise<GenerationManifest> {
    try {
      const path = this.manifestPath(identity);
      await this.prepare();
      await this.directory(join(this.root, 'manifests', identity.rootId));
      return validateManifest(await this.bytes(path, GENERATION_LIMITS.manifestBytes), refFor(binding, identity), binding);
    } catch (error) { this.fail(error); }
  }
  async readBlob(item: GenerationFile): Promise<Uint8Array | null> {
    try {
      await this.prepare(); digest(item.sha256);
      let bytes: Uint8Array;
      try { bytes = await this.bytes(join(this.root, 'blobs', item.sha256), item.size, 'blob_mismatch'); }
      catch (error) { if (missing(error)) return null; throw error; }
      requireGeneration(bytes.length === item.size && sha256(bytes) === item.sha256, 'blob_mismatch');
      return bytes;
    } catch (error) { this.fail(error); }
  }
  async putBlob(item: GenerationFile, bytes: Uint8Array): Promise<void> {
    try {
      await this.prepare(); digest(item.sha256);
      requireGeneration(bytes.length === item.size && sha256(bytes) === item.sha256, 'blob_mismatch');
      await this.atomic(join(this.root, 'blobs', item.sha256), bytes, item.sha256, 'blob');
    } catch (error) { this.fail(error); }
  }
  async putManifest(identity: GenerationIdentity, bytes: Uint8Array, binding: GenerationBinding): Promise<void> {
    try {
      await this.prepare();
      validateManifest(bytes, refFor(binding, identity), binding);
      await this.directory(join(this.root, 'manifests', identity.rootId));
      await this.syncDirectory(join(this.root, 'manifests'));
      await this.atomic(this.manifestPath(identity), bytes, identity.manifestSha256, 'manifest');
    } catch (error) { this.fail(error); }
  }
  async activate(expected: PointerSnapshot, binding: GenerationBinding, identity: GenerationIdentity): Promise<void> {
    try {
      await withPromotion(this.pointerPath(binding.rootId), async () => {
        this.check();
        const current = await this.snapshot(binding.rootId);
        requireGeneration(current.bytes === null ? expected.bytes === null : expected.bytes !== null && equalBytes(current.bytes, expected.bytes), 'superseded');
        this.assertBinding(current, binding);
        validateRef(refFor(binding, identity), binding, current.pointer?.generation ?? null);
        const manifest = await this.manifest(identity, binding);
        const required = new Set(manifest.presentations.flatMap(item => item.required_paths));
        for (const item of manifest.files) if (required.has(item.path))
          requireGeneration(await this.readBlob(item) !== null, 'store_unavailable');
        const pointer: StoredPointer = { schema: 'hq-generation-pointer/v1', binding, generation: identity };
        const bytes = canonicalJson(pointer);
        await this.atomic(this.pointerPath(binding.rootId), bytes, sha256(bytes), 'pointer');
      });
    } catch (error) { this.fail(error); }
  }
  async confirmCurrent(expected: PointerSnapshot, rootId: string): Promise<void> {
    try {
      await withPromotion(this.pointerPath(rootId), async () => {
        const current = await this.snapshot(rootId);
        requireGeneration(current.bytes === null ? expected.bytes === null : expected.bytes !== null && equalBytes(current.bytes, expected.bytes), 'superseded');
      });
    } catch (error) { this.fail(error); }
  }
}
