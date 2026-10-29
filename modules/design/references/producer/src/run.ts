import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AssembledSource } from './assemble.ts';
import { assemble } from './assemble.ts';
import type { ProducerConfig } from './config.ts';
import { fail } from './errors.ts';
import type { SourceRead } from './gallery.ts';
import { readGallery } from './gallery.ts';
import { assertNoGitAncestor, isInside } from './safe-fs.ts';
import { ensureStore, writeSource } from './store.ts';
import { readStudy } from './study.ts';

export interface SourceReport {
  /** Position in the configuration; the configured ID is never reported. */
  readonly index: number;
  readonly kind: 'gallery' | 'study';
  readonly status: 'written' | 'unchanged' | 'empty';
  readonly filesRead: number;
  readonly bytesRead: number;
  readonly counts: Readonly<Record<string, number>>;
  readonly tallies: Readonly<Record<string, number>>;
  readonly internalDigest: string | null;
  readonly publishableDigest: string | null;
}

export interface ProducerReport {
  readonly sources: readonly SourceReport[];
}

/** Test seams. They run between reading and writing and are never used by the CLI. */
export interface RunHooks {
  readonly afterRead?: () => Promise<void> | void;
}

/**
 * Runs every configured source. Nothing is written until every source has been read, packaged and
 * re-checked for change: a failure or a generation change anywhere means no output at all.
 */
export async function runProducer(config: ProducerConfig, hooks: RunHooks = {}): Promise<ProducerReport> {
  await assertNoGitAncestor(config.outputRoot);
  const outputReal = await realOfNearest(config.outputRoot);
  for (const source of config.sources) {
    let root: string;
    try { root = await fs.realpath(source.root); } catch { return fail('source-root-unavailable'); }
    if (isInside(root, outputReal) || isInside(outputReal, root)) return fail('output-overlaps-source');
  }

  const reads: { read: SourceRead; assembled: AssembledSource | null }[] = [];
  for (const source of config.sources) {
    const read = source.kind === 'gallery' ? await readGallery(source) : await readStudy(source);
    reads.push({ read, assembled: await assemble(read) });
  }
  await hooks.afterRead?.();
  for (const { read } of reads) await read.recheck();

  let store: string | null = null;
  const reports: SourceReport[] = [];
  for (const [index, source] of config.sources.entries()) {
    const { read, assembled } = reads[index]!;
    if (assembled === null) {
      reports.push({ index, kind: source.kind, status: 'empty', filesRead: read.filesRead, bytesRead: read.bytesRead, counts: {}, tallies: read.tally.toJSON(), internalDigest: null, publishableDigest: null });
      continue;
    }
    store ??= await ensureStore(config.outputRoot);
    const stored = await writeSource(store, source.id, assembled, read.tally);
    reports.push({
      index, kind: source.kind, status: stored.status, filesRead: read.filesRead, bytesRead: read.bytesRead, counts: assembled.counts,
      tallies: read.tally.toJSON(), internalDigest: stored.internalDigest, publishableDigest: stored.publishableDigest,
    });
  }
  return { sources: reports };
}

/** Real path of the nearest existing ancestor, with the not-yet-existing tail re-appended. */
async function realOfNearest(target: string): Promise<string> {
  const tail: string[] = [];
  for (let current = path.resolve(target); ; current = path.dirname(current)) {
    try { return path.join(await fs.realpath(current), ...tail.reverse()); } catch {
      if (path.dirname(current) === current) return fail('output-unresolvable');
      tail.push(path.basename(current));
    }
  }
}
