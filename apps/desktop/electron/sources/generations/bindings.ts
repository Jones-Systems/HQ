import * as fs from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, normalize, parse } from 'node:path';
import { keys, record } from '../../services.js';
import { canonicalJson, codePointCompare, equalBytes, parseCanonicalJson, sha256 } from './canonical-json.js';
import { counter, digest, opaque } from './paths.js';
import type { GenerationBinding } from './types.js';
import { requireGeneration } from './types.js';
import { validateBinding } from './wire.js';

export type BindingSetHoldReason = 'bindings_unavailable' | 'bindings_untrusted' | 'bindings_invalid'
  | 'bindings_rollback' | 'bindings_fork' | 'bindings_identity_changed';
export interface AcceptedBindingSet { hostId: string; setRevision: string; sha256: string }
export interface ConsumerBindingSet {
  publisherId: string; hostId: string; origin: string; setRevision: string; sha256: string;
  bindings: readonly GenerationBinding[];
}
export type BindingSetRead =
  | { kind: 'advanced' | 'unchanged'; set: ConsumerBindingSet }
  | { kind: 'held'; reason: BindingSetHoldReason };
export interface BindingSetDiff {
  added: GenerationBinding[]; unchanged: GenerationBinding[]; notIssued: GenerationBinding[];
  rebound: { from: GenerationBinding; to: GenerationBinding }[];
  scopeChanged: { from: GenerationBinding; to: GenerationBinding }[];
}
const MAXIMUM = 64 * 1024;
const held = (reason: BindingSetHoldReason): BindingSetRead => ({ kind: 'held', reason });
function fields(value: unknown, names: readonly string[]): asserts value is Record<string, unknown> {
  requireGeneration(record(value) && keys(value, names));
}

// A1 accepts timezone-aware ISO dates, including basic and week forms. Keep
// provenance validation local: this interface does not extend any H0 validator.
function observedAt(value: unknown): void {
  requireGeneration(typeof value === 'string' && value.length <= 40);
  const text = value.replaceAll('Z', '+00:00');
  const date = /^(?:\d{4}-\d{2}-\d{2}|\d{8}|\d{4}-W\d{2}(?:-\d)?|\d{4}W\d{2}\d?)/.exec(text)?.[0];
  requireGeneration(date);
  const year = Number(date.slice(0, 4));
  requireGeneration(year >= 1);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const week = /W(\d{2})(?:-?(\d))?$/.exec(date);
  if (week) {
    const first = new Date(0); first.setUTCFullYear(year, 0, 1); first.setUTCHours(0, 0, 0, 0);
    const maximum = first.getUTCDay() === 4 || (leap && first.getUTCDay() === 3) ? 53 : 52;
    const number = Number(week[1]), day = Number(week[2] ?? 1);
    requireGeneration(number >= 1 && number <= maximum && day >= 1 && day <= 7);
    first.setUTCDate(4);
    first.setUTCDate(4 - (first.getUTCDay() + 6) % 7 + (number - 1) * 7 + day - 1);
    requireGeneration(first.getUTCFullYear() >= 1 && first.getUTCFullYear() <= 9999);
  } else {
    const compact = date.replaceAll('-', ''), month = Number(compact.slice(4, 6)), day = Number(compact.slice(6, 8));
    requireGeneration(month >= 1 && month <= 12 && day >= 1
      && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]);
  }
  const timeAndZone = Array.from(text.slice(date.length)).slice(1).join('');
  const split = timeAndZone.search(/[+-]/);
  requireGeneration(split > 0);
  const pattern = /^(\d{2})(?:(:?)(\d{2})(?:\2(\d{2}))?)?(?:[.,](\d+))?$/;
  const timeText = timeAndZone.slice(0, split), zoneText = timeAndZone.slice(split + 1);
  const time = pattern.exec(timeText), zone = pattern.exec(zoneText);
  requireGeneration(time && zone && time[0] === timeText && zone[0] === zoneText);
  requireGeneration(Number(time[1]) <= 23 && Number(time[3] ?? 0) <= 59 && Number(time[4] ?? 0) <= 59);
  requireGeneration(Number(zone[1]) * 3600 + Number(zone[3] ?? 0) * 60 + Number(zone[4] ?? 0) < 86400);
}

export function parseConsumerBindingSet(bytes: Uint8Array, publisherId: string, accepted: AcceptedBindingSet | null): BindingSetRead {
  try {
    opaque(publisherId);
    if (accepted !== null) { opaque(accepted.hostId); counter(accepted.setRevision); digest(accepted.sha256); }
    const value = parseCanonicalJson(bytes, MAXIMUM);
    fields(value, ['schema', 'completeness', 'publisher_id', 'host_id', 'origin', 'roots', 'set_revision', 'provenance']);
    requireGeneration(value.schema === 'hq-sync.consumer-bindings/v1' && value.completeness === 'complete-for-publisher-binding');
    opaque(value.publisher_id); opaque(value.host_id); counter(value.set_revision);
    fields(value.provenance, ['forward_binding_id', 'request_digest', 'observed_at']);
    digest(value.provenance.forward_binding_id); digest(value.provenance.request_digest); observedAt(value.provenance.observed_at);
    requireGeneration(Array.isArray(value.roots) && value.roots.length <= 64);
    // Validate the origin even when the complete set contains no roots.
    validateBinding({ origin: value.origin as string, publisherId: value.publisher_id, hostId: value.host_id,
      rootId: 'validation-root', bindingRevision: 'validation-revision', scopeDigest: '0'.repeat(64), consistencyMode: 'observed-files-v1' });
    const bindings: GenerationBinding[] = [];
    let prior: string | null = null;
    for (const root of value.roots) {
      fields(root, ['root_id', 'binding_revision', 'scope_digest', 'consistency_mode']);
      opaque(root.root_id);
      requireGeneration(prior === null || codePointCompare(prior, root.root_id) < 0);
      prior = root.root_id;
      bindings.push(validateBinding({ origin: value.origin as string, publisherId: value.publisher_id, hostId: value.host_id,
        rootId: root.root_id, bindingRevision: root.binding_revision as string, scopeDigest: root.scope_digest as string,
        consistencyMode: root.consistency_mode as GenerationBinding['consistencyMode'] }));
    }
    if (value.publisher_id !== publisherId || (accepted && value.host_id !== accepted.hostId)) return held('bindings_identity_changed');
    const checksum = sha256(bytes);
    const set: ConsumerBindingSet = { publisherId, hostId: value.host_id, origin: value.origin as string,
      setRevision: value.set_revision, sha256: checksum, bindings };
    if (!accepted) return { kind: 'advanced', set };
    if (checksum === accepted.sha256) return { kind: 'unchanged', set };
    if (BigInt(set.setRevision) < BigInt(accepted.setRevision)) return held('bindings_rollback');
    if (set.setRevision === accepted.setRevision) return held('bindings_fork');
    return { kind: 'advanced', set };
  } catch { return held('bindings_invalid'); }
}

export function bindingKey(binding: GenerationBinding): string {
  return new TextDecoder().decode(canonicalJson([binding.publisherId, binding.hostId, binding.rootId]));
}
export function rebindable(from: GenerationBinding, to: GenerationBinding): boolean {
  return from.publisherId === to.publisherId && from.hostId === to.hostId && from.rootId === to.rootId
    && from.scopeDigest === to.scopeDigest && from.consistencyMode === to.consistencyMode
    && (from.bindingRevision !== to.bindingRevision || from.origin !== to.origin);
}
export function diffBindingSets(previous: readonly GenerationBinding[], next: readonly GenerationBinding[]): BindingSetDiff {
  const result: BindingSetDiff = { added: [], unchanged: [], notIssued: [], rebound: [], scopeChanged: [] };
  const before = new Map(previous.map(binding => [bindingKey(binding), binding]));
  const after = new Map(next.map(binding => [bindingKey(binding), binding]));
  const order = (a: GenerationBinding, b: GenerationBinding) => codePointCompare(a.rootId, b.rootId) || codePointCompare(bindingKey(a), bindingKey(b));
  for (const to of [...after.values()].sort(order)) {
    const from = before.get(bindingKey(to));
    if (!from) result.added.push(to);
    else if (equalBytes(canonicalJson(from), canonicalJson(to))) result.unchanged.push(to);
    else if (rebindable(from, to)) result.rebound.push({ from, to });
    else result.scopeChanged.push({ from, to });
  }
  result.notIssued = [...before.values()].filter(binding => !after.has(bindingKey(binding))).sort(order);
  return result;
}

interface ReaderStat {
  dev: bigint; ino: bigint; uid: bigint; mode: bigint; nlink: bigint; size: bigint;
  isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean;
}
interface ReaderHandle {
  stat(options: { bigint: true }): Promise<ReaderStat>;
  read(buffer: Uint8Array, offset: number, length: number, position: number | null): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}
export interface ConsumerBindingReaderSeam {
  home(): string; platform: string; uid: (() => number) | undefined;
  constants: { O_RDONLY: number; O_NOFOLLOW?: number; O_NONBLOCK?: number; O_DIRECTORY?: number };
  fs: { lstat(path: string, options: { bigint: true }): Promise<ReaderStat>; open(path: string, flags: number): Promise<ReaderHandle> };
  afterFileStat?(): Promise<void>; afterRead?(): Promise<void>;
}

// Test construction only. Production exports retain the fixed-home reader;
// paths, filesystem implementations and race hooks never cross that boundary.
export function createConsumerBindingReader(seam: ConsumerBindingReaderSeam) {
  return async (publisherId: string, accepted: AcceptedBindingSet | null): Promise<BindingSetRead> => {
    try { opaque(publisherId); } catch { return held('bindings_invalid'); }
    let bytes: Uint8Array;
    try {
      const c = seam.constants;
      requireGeneration((seam.platform === 'linux' || seam.platform === 'darwin') && typeof seam.uid === 'function'
        && typeof c.O_RDONLY === 'number' && [c.O_NOFOLLOW, c.O_NONBLOCK, c.O_DIRECTORY].every(value => typeof value === 'number' && Number.isInteger(value) && value > 0));
      const uid = BigInt(seam.uid());
      const homePath = seam.home();
      requireGeneration(isAbsolute(homePath) && !homePath.includes('\0') && normalize(homePath) === homePath);
      const home = homePath === '/' ? homePath : homePath.replace(/\/$/, '');
      const directory = join(home, '.local', 'share', 'host-tooling', 'hq-sync', 'consumer-bindings');
      const file = join(directory, publisherId + '.json');
      const privateDirectory = (info: ReaderStat) => info.isDirectory() && !info.isSymbolicLink() && info.uid === uid && (info.mode & 0o022n) === 0n;
      const privateFile = (info: ReaderStat) => info.isFile() && !info.isSymbolicLink() && info.uid === uid
        && (info.mode & 0o077n) === 0n && info.nlink === 1n && info.size >= 0n && info.size <= BigInt(MAXIMUM);
      const same = (a: ReaderStat, b: ReaderStat) => typeof a.dev === 'bigint' && typeof a.ino === 'bigint'
        && a.dev === b.dev && a.ino === b.ino;
      async function chain(): Promise<ReaderStat> {
        let path = parse(directory).root;
        let info = await seam.fs.lstat(path, { bigint: true });
        requireGeneration(info.isDirectory() && !info.isSymbolicLink());
        if (path === home) requireGeneration(privateDirectory(info));
        for (const segment of directory.slice(path.length).split('/')) {
          path = join(path, segment); info = await seam.fs.lstat(path, { bigint: true });
          requireGeneration(info.isDirectory() && !info.isSymbolicLink());
          if (path === home || path.startsWith(home === '/' ? '/' : home + '/')) requireGeneration(privateDirectory(info));
        }
        return info;
      }
      await chain();
      let dir: ReaderHandle | undefined, content: ReaderHandle | undefined;
      try {
        dir = await seam.fs.open(directory, c.O_RDONLY | c.O_DIRECTORY! | c.O_NOFOLLOW!);
        const dirInfo = await dir.stat({ bigint: true }); requireGeneration(privateDirectory(dirInfo));
        content = await seam.fs.open(file, c.O_RDONLY | c.O_NOFOLLOW! | c.O_NONBLOCK!);
        const fileInfo = await content.stat({ bigint: true }); requireGeneration(privateFile(fileInfo));
        await seam.afterFileStat?.();
        const buffer = new Uint8Array(MAXIMUM + 1);
        let total = 0;
        while (total < buffer.length) {
          const part = await content.read(buffer, total, Math.min(8192, buffer.length - total), null);
          if (part.bytesRead === 0) break;
          total += part.bytesRead;
          requireGeneration(total <= MAXIMUM);
        }
        requireGeneration(BigInt(total) === fileInfo.size && total <= MAXIMUM);
        await seam.afterRead?.();
        const afterFile = await seam.fs.lstat(file, { bigint: true }), afterDir = await seam.fs.lstat(directory, { bigint: true });
        requireGeneration(same(afterFile, fileInfo) && privateFile(afterFile) && afterFile.size === fileInfo.size
          && same(afterDir, dirInfo) && privateDirectory(afterDir));
        requireGeneration(same(await chain(), dirInfo));
        bytes = buffer.slice(0, total);
      } finally { try { await content?.close(); } finally { await dir?.close(); } }
    } catch (error) {
      return held((error as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'bindings_unavailable' : 'bindings_untrusted');
    }
    return parseConsumerBindingSet(bytes, publisherId, accepted);
  };
}
const reader = createConsumerBindingReader({ home: homedir, platform: process.platform, uid: process.getuid, constants: fs.constants, fs });
export function readConsumerBindingSet(publisherId: string, accepted: AcceptedBindingSet | null): Promise<BindingSetRead> {
  return reader(publisherId, accepted);
}
