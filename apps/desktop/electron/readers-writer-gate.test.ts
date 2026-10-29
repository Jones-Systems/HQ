import { expect, it } from 'vitest';
import { ReadersWriterGate } from './readers-writer-gate';
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
it('overlaps readers, excludes writers and prevents writer starvation', async () => {
  const gate = new ReadersWriterGate(), release = deferred(), entered = deferred(), order: string[] = [];
  const r1 = gate.shared(async () => { order.push('read1'); await release.promise; });
  const r2 = gate.shared(async () => { order.push('read2'); entered.resolve(); await release.promise; });
  const w = gate.exclusive(async () => { order.push('write'); });
  const r3 = gate.shared(async () => { order.push('read3'); });
  await entered.promise; expect(order).toEqual(['read1', 'read2']);
  release.resolve(); await Promise.all([r1, r2, w, r3]);
  expect(order).toEqual(['read1', 'read2', 'write', 'read3']);
  await expect(gate.exclusive(async () => { throw Error('fixture'); })).rejects.toThrow('fixture');
  expect(await gate.shared(async () => 'released')).toBe('released');
});
