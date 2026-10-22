import { createReadStream } from 'node:fs';
import { mkdir, open, realpath, symlink, type FileHandle } from 'node:fs/promises';
import { dirname, join, posix, relative, sep } from 'node:path';
import { createInflateRaw } from 'node:zlib';
import type { UpdateManifest } from '@hq/contracts/updates';
import { UpdateFailure, checkAbort, contract, nativeVerifier, receiptOf } from './contract.js';

interface Entry {
  readonly name: string;
  readonly kind: 'file' | 'directory' | 'symlink';
  readonly mode: number;
  readonly method: number;
  readonly flags: number;
  readonly crc: number;
  readonly size: number;
  readonly compressedSize: number;
  readonly offset: number;
  readonly start: number;
}
const crcTable = new Uint32Array(256).map((_, n) => {
  let value = n;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});

async function read(file: FileHandle, offset: number, size: number): Promise<Buffer> {
  const buffer = Buffer.alloc(size);
  let received = 0;
  while (received < size) {
    const { bytesRead } = await file.read(buffer, received, size - received, offset + received);
    if (bytesRead === 0) throw new UpdateFailure('integrity');
    received += bytesRead;
  }
  return buffer;
}

export function archivePath(name: string): string {
  if (name.length > 4096 || /[\\\x00-\x1f\x7f]/.test(name) || !name.startsWith('HQ.app/') || name.normalize('NFC') !== name) throw new UpdateFailure('integrity');
  const trimmed = name.endsWith('/') ? name.slice(0, -1) : name;
  if (trimmed.split('/').some(part => !part || part === '.' || part === '..' || /[:]/.test(part)) || posix.normalize(trimmed) !== trimmed) throw new UpdateFailure('integrity');
  return trimmed;
}

export async function inspectArchive(path: string, manifest: UpdateManifest): Promise<readonly Entry[]> {
  const file = await open(path, 'r');
  try {
    const size = (await file.stat()).size;
    if (size !== manifest.archive.size || size < 22 || size > contract.MAX_ARCHIVE_BYTES) throw new UpdateFailure('integrity');
    const tail = await read(file, Math.max(0, size - 65557), Math.min(size, 65557));
    let end = -1;
    for (let index = tail.length - 22; index >= 0; index--) {
      if (tail.readUInt32LE(index) === 0x06054b50 && index + 22 + tail.readUInt16LE(index + 20) === tail.length) { end = index; break; }
    }
    if (end < 0 || tail.readUInt16LE(end + 4) !== 0 || tail.readUInt16LE(end + 6) !== 0) throw new UpdateFailure('integrity');
    const count = tail.readUInt16LE(end + 10), centralSize = tail.readUInt32LE(end + 12), centralOffset = tail.readUInt32LE(end + 16);
    if (!count || count === 65535 || count !== tail.readUInt16LE(end + 8) || count !== manifest.archive.fileCount || count > contract.MAX_FILE_COUNT || centralSize > 32 * 1024 * 1024 || centralOffset + centralSize !== size - tail.length + end) throw new UpdateFailure('integrity');
    const central = await read(file, centralOffset, centralSize), entries: Entry[] = [], names = new Set<string>();
    let cursor = 0, expanded = 0;
    for (let index = 0; index < count; index++) {
      if (cursor + 46 > central.length || central.readUInt32LE(cursor) !== 0x02014b50) throw new UpdateFailure('integrity');
      const flags = central.readUInt16LE(cursor + 8), method = central.readUInt16LE(cursor + 10), crc = central.readUInt32LE(cursor + 16), compressedSize = central.readUInt32LE(cursor + 20), entrySize = central.readUInt32LE(cursor + 24);
      const nameSize = central.readUInt16LE(cursor + 28), extraSize = central.readUInt16LE(cursor + 30), commentSize = central.readUInt16LE(cursor + 32), offset = central.readUInt32LE(cursor + 42);
      if (cursor + 46 + nameSize + extraSize + commentSize > central.length || central.readUInt16LE(cursor + 34) !== 0 || flags & ~(0x800 | 8 | 6) || ![0, 8].includes(method) || compressedSize === 0xffffffff || entrySize === 0xffffffff || offset === 0xffffffff) throw new UpdateFailure('integrity');
      const rawName = central.subarray(cursor + 46, cursor + 46 + nameSize);
      if (!(flags & 0x800) && rawName.some(byte => byte >= 128)) throw new UpdateFailure('integrity');
      const originalName = new TextDecoder('utf-8', { fatal: true }).decode(rawName), name = archivePath(originalName);
      const caseName = name.toLowerCase();
      if (names.has(caseName)) throw new UpdateFailure('integrity');
      names.add(caseName);
      const mode = central.readUInt32LE(cursor + 38) >>> 16, type = mode & 0xf000;
      if (![0, 0x8000, 0x4000, 0xa000].includes(type)) throw new UpdateFailure('integrity');
      const kind = originalName.endsWith('/') ? 'directory' : type === 0xa000 ? 'symlink' : 'file';
      if (kind === 'directory' && (entrySize !== 0 || compressedSize !== 0 || ![0, 0x4000].includes(type)) || kind === 'file' && type === 0x4000 || kind === 'symlink' && (entrySize === 0 || entrySize > 4096)) throw new UpdateFailure('integrity');
      expanded += entrySize;
      if (expanded > manifest.archive.expandedSize || expanded > contract.MAX_EXPANDED_BYTES || offset + 30 > centralOffset) throw new UpdateFailure('integrity');
      const local = await read(file, offset, 30);
      if (local.readUInt32LE(0) !== 0x04034b50 || local.readUInt16LE(6) !== flags || local.readUInt16LE(8) !== method || local.readUInt16LE(26) !== nameSize) throw new UpdateFailure('integrity');
      const localName = await read(file, offset + 30, nameSize);
      if (!localName.equals(rawName)) throw new UpdateFailure('integrity');
      if (!(flags & 8) && (local.readUInt32LE(14) !== crc || local.readUInt32LE(18) !== compressedSize || local.readUInt32LE(22) !== entrySize)) throw new UpdateFailure('integrity');
      const start = offset + 30 + nameSize + local.readUInt16LE(28);
      if (start + compressedSize > centralOffset) throw new UpdateFailure('integrity');
      entries.push({ name, kind, mode, method, flags, crc, size: entrySize, compressedSize, offset, start });
      cursor += 46 + nameSize + extraSize + commentSize;
    }
    if (cursor !== centralSize || expanded !== manifest.archive.expandedSize) throw new UpdateFailure('integrity');
    const byName = new Map(entries.map(entry => [entry.name.toLowerCase(), entry]));
    const ranges = [...entries].sort((a, b) => a.offset - b.offset);
    for (let index = 0; index < ranges.length; index++) {
      const entry = ranges[index]!;
      if (index && ranges[index - 1]!.start + ranges[index - 1]!.compressedSize > entry.offset) throw new UpdateFailure('integrity');
      for (let ancestor = posix.dirname(entry.name); ancestor !== '.'; ancestor = posix.dirname(ancestor)) {
        const parent = byName.get(ancestor.toLowerCase());
        if (parent && parent.kind !== 'directory') throw new UpdateFailure('integrity');
      }
    }
    return entries;
  } finally { await file.close(); }
}

async function consume(path: string, entry: Entry, signal: AbortSignal, write: (chunk: Buffer) => Promise<void>): Promise<void> {
  checkAbort(signal);
  if (entry.compressedSize === 0) {
    if (entry.size !== 0 || entry.crc !== 0) throw new UpdateFailure('integrity');
    return;
  }
  const source = createReadStream(path, { start: entry.start, end: entry.start + entry.compressedSize - 1, signal });
  const inflater = entry.method === 8 ? createInflateRaw() : null;
  const output = inflater ? source.compose(inflater) : source;
  let size = 0, crc = 0xffffffff;
  try {
    for await (const value of output) {
      checkAbort(signal);
      const chunk = Buffer.from(value as Uint8Array);
      size += chunk.length;
      if (size > entry.size) throw new UpdateFailure('integrity');
      for (const byte of chunk) crc = crcTable[(crc ^ byte) & 0xff]! ^ crc >>> 8;
      await write(chunk);
    }
    if (size !== entry.size || ((crc ^ 0xffffffff) >>> 0) !== entry.crc) throw new UpdateFailure('integrity');
  } finally { source.destroy(); inflater?.destroy(); output.destroy(); }
}

export async function extractArchive(path: string, destination: string, manifest: UpdateManifest, signal: AbortSignal): Promise<string> {
  const entries = await inspectArchive(path, manifest);
  checkAbort(signal);
  await mkdir(destination, { mode: 0o700 });
  const links: { entry: Entry; target: string }[] = [];
  for (const entry of entries.filter(value => value.kind === 'symlink')) {
    const parts: Buffer[] = [];
    await consume(path, entry, signal, async chunk => { parts.push(chunk); });
    const target = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts));
    const resolved = posix.normalize(posix.join(posix.dirname(entry.name), target));
    if (!target || posix.isAbsolute(target) || /[\\\x00-\x1f\x7f:]/.test(target) || !resolved.startsWith('HQ.app/')) throw new UpdateFailure('integrity');
    links.push({ entry, target });
  }
  for (const entry of entries.filter(value => value.kind !== 'symlink')) {
    checkAbort(signal);
    const target = join(destination, ...entry.name.split('/'));
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    if (entry.kind === 'directory') { await mkdir(target, { recursive: true, mode: 0o700 }); continue; }
    const output = await open(target, 'wx', entry.mode & 0o111 ? 0o700 : 0o600);
    try { await consume(path, entry, signal, async chunk => { await output.writeFile(chunk); }); await output.sync(); }
    finally { await output.close(); }
  }
  for (const { entry, target } of links) {
    checkAbort(signal);
    const output = join(destination, ...entry.name.split('/'));
    await mkdir(dirname(output), { recursive: true, mode: 0o700 });
    await symlink(target, output);
  }
  const bundlePath = join(destination, 'HQ.app'), bundleReal = await realpath(bundlePath);
  for (const { entry } of links) {
    const resolved = await realpath(join(destination, ...entry.name.split('/')));
    const child = relative(bundleReal, resolved);
    if (child === '..' || child.startsWith(`..${sep}`) || child.startsWith(sep)) throw new UpdateFailure('integrity');
  }
  checkAbort(signal);
  return bundlePath;
}

export type BundleVerifier = (path: string, manifest: UpdateManifest, signal: AbortSignal) => Promise<void>;
export const verifyNativeBundle: BundleVerifier = async (path, manifest, signal) => {
  checkAbort(signal);
  await nativeVerifier().verifyBundle(path, receiptOf(manifest));
  checkAbort(signal);
};
