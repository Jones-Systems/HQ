import { promises as fs } from 'node:fs';
import path from 'node:path';
import { canonicalize } from '../../src/jcs.ts';
import type { AssembledSource } from './assemble.ts';
import { fail } from './errors.ts';
import { assertNoGitAncestor } from './safe-fs.ts';
import type { Tally } from './tally.ts';

export const STORE_MARKER = '.hq-producer-store';
export const RECEIPT_SCHEMA = 'hq.design.reference-producer-receipt/v1';

/**
 * Makes `root` an owned external store: it must have no Git ancestor of any kind, and it is either
 * new, empty, or already marked as a producer store. Anything else is refused, never adopted.
 */
export async function ensureStore(root: string): Promise<string> {
  await assertNoGitAncestor(root);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const real = await fs.realpath(root);
  await assertNoGitAncestor(real);
  const entries = await fs.readdir(real);
  if (entries.includes(STORE_MARKER)) {
    const stat = await fs.lstat(path.join(real, STORE_MARKER));
    if (!stat.isFile()) return fail('output-not-owned');
  } else if (entries.length === 0) {
    await fs.writeFile(path.join(real, STORE_MARKER), 'hq.design.reference-producer-store/v1\n', { flag: 'wx', mode: 0o600 });
  } else {
    return fail('output-not-owned');
  }
  return real;
}

const line = (value: unknown): string => `${canonicalize(value)}\n`;
const hexOf = (digest: string): string => digest.slice('sha256:'.length);

export interface StoredSource {
  readonly status: 'written' | 'unchanged';
  readonly internalDigest: string;
  readonly publishableDigest: string;
}

/**
 * Writes one source's packets, blobs and an aggregate receipt under `<store>/<source id>/<digest>/`.
 * Everything is staged in a temporary directory beside the target and renamed into place, so a
 * packet set is either complete or absent. Re-running an unchanged source writes nothing new.
 */
export async function writeSource(store: string, sourceId: string, assembled: AssembledSource, tally: Tally): Promise<StoredSource> {
  const internalDigest = assembled.internal.packetDigest;
  const publishableDigest = assembled.publishable.packetDigest;
  const sourceDir = path.join(store, sourceId);
  const target = path.join(sourceDir, hexOf(internalDigest));
  const internalBytes = line(assembled.internal);
  await fs.mkdir(sourceDir, { recursive: true, mode: 0o700 });
  try {
    const existing = await fs.readFile(path.join(target, 'internal.packet.json'), 'utf8');
    if (existing === internalBytes) return { status: 'unchanged', internalDigest, publishableDigest };
    return fail('output-conflict');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const staging = await fs.mkdtemp(path.join(store, '.staging-'));
  try {
    await fs.mkdir(path.join(staging, 'blobs'), { mode: 0o700 });
    await fs.writeFile(path.join(staging, 'internal.packet.json'), internalBytes, { flag: 'wx', mode: 0o600 });
    await fs.writeFile(path.join(staging, 'publishable.packet.json'), line(assembled.publishable), { flag: 'wx', mode: 0o600 });
    for (const [digest, bytes] of assembled.blobs) await fs.writeFile(path.join(staging, 'blobs', hexOf(digest)), bytes, { flag: 'wx', mode: 0o600 });
    await fs.writeFile(path.join(staging, 'receipt.json'), line({
      schema: RECEIPT_SCHEMA, internalDigest, publishableDigest, counts: assembled.counts, tallies: tally.toJSON(),
    }), { flag: 'wx', mode: 0o600 });
    await fs.rename(staging, target);
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true });
    throw error;
  }
  return { status: 'written', internalDigest, publishableDigest };
}
