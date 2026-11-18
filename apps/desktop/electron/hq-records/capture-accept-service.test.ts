import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { WorkspaceBacking } from '../../../../modules/design/app/storage/backing.ts';
import type { Digest } from './canonical.js';
import {
  captureReceiptDigest, decodeCaptureBinding, decodeCaptureOperation, staticCaptureEligible,
  type CaptureAcceptRequest, type CaptureReceipt,
} from './capture-evidence.js';
import { captureOperationKey, captureReceiptKey } from './keys.js';
import {
  createCaptureAcceptService, type CaptureAcceptBacking, type CaptureAcceptPut, type CaptureDocument,
} from './capture-accept-service.js';

const time = '2026-11-02T00:00:03Z';
const versionId = 'vcap-c6382ed815646bd6fdec00b2b950eaea8f8c8c2f';
const bindingKey = 'hq/captures/bindings/11afb78d0ebc38cb2df961c563fba0007d35b462413967fd3e2e9c489fb5976c';
const operationKey = captureOperationKey('accept-1');
const receiptKey = captureReceiptKey('capture-1');
const otherDigest: Digest = `sha256:${'0'.repeat(64)}`;

// Synthetic evidence only; binding it does not attest a producer or qualify Compare.
function receipt(): CaptureReceipt {
  return {
    schema: 'hq.design.capture-evidence/v1', captureId: 'capture-1',
    producer: { id: 'hq.electron-preview', contract: 1, mode: 'production', appVersion: '0.0.0-synthetic', packaged: false },
    host: { sessionId: 'synthetic-session', hostVersionId: 'synthetic-host-version', generation: 7 },
    page: { origin: 'https://example.com', route: '/design?view=1', state: '' }, viewport: { w: 1920, h: 1080, dpr: 1 },
    scroll: { x: 0.1, y: 1e-7 }, pageExtentCss: { width: 1920.5, height: 1080.25 },
    imageRectCss: { x: 0, y: 0, width: 1920.5, height: 1080.25 },
    image: { mediaType: 'image/png', digest: `sha256:${'a'.repeat(64)}`, byteLength: 1234, pixelWidth: 1921, pixelHeight: 1081 },
    time: { capturedAt: '2026-11-02T00:00:01Z', basis: 'host-clock-after-coherence-before-persist',
      acquisition: { start: '2026-11-02T00:00:00Z', end: '2026-11-02T00:00:01Z' } },
    persistedAt: '2026-11-02T00:00:02Z', fixture: { state: 'known-absent', attestedBy: 'hq.electron-preview/contract-1' },
  };
}

function request(value = receipt()): CaptureAcceptRequest {
  return { operationId: 'accept-1', projectId: 'project-1', viewId: 'view-1', captureId: 'capture-1',
    receiptDigest: captureReceiptDigest(value), captureDigest: value.image.digest, versionDigest: `sha256:${'b'.repeat(64)}` };
}

function copy<T>(value: T): T { return structuredClone(value); }
function conflict(): Error { return Object.assign(new Error('CAS refused'), { name: 'StoreError', code: 'conflict' }); }

class AtomicBacking implements CaptureAcceptBacking {
  documents = new Map<string, CaptureDocument>();
  readonly trace: string[] = [];
  readonly batches: (readonly CaptureAcceptPut[])[] = [];
  readonly visiblePairs: (readonly boolean[])[] = [];
  readonly getDocument = vi.fn(async (key: string): Promise<CaptureDocument | null> => {
    this.trace.push(`read:${key}`);
    return copy(this.documents.get(key) ?? null);
  });
  readonly commitPuts = vi.fn(async (puts: readonly CaptureAcceptPut[]): Promise<readonly CaptureDocument[]> => {
    this.trace.push('commit');
    this.batches.push(copy(puts));
    this.visiblePairs.push(puts.map(put => this.documents.has(put.key)));
    for (const put of puts) {
      if (put.expectedRevision !== null || this.documents.has(put.key)) throw conflict();
    }
    const committed = puts.map(put => ({ key: put.key, revision: 1, value: copy(put.value) }));
    const next = new Map(this.documents);
    for (const document of committed) next.set(document.key, document);
    this.documents = next;
    this.visiblePairs.push(puts.map(put => this.documents.has(put.key)));
    return copy(committed);
  });
  seed(key: string, revision: number, value: unknown) {
    this.documents.set(key, { key, revision, value: copy(value) });
  }
}

function service(backing = new AtomicBacking()) {
  const now = vi.fn(() => { backing.trace.push('clock'); return time; });
  return { backing, now, api: createCaptureAcceptService({ backing, now }) };
}

function seeded(value = receipt()) {
  const ctx = service();
  ctx.backing.seed(receiptKey, 7, value);
  return ctx;
}

describe('uncomposed capture acceptance service', () => {
  it('accepts the existing atomic workspace port structurally and remains inert on construction', () => {
    expectTypeOf<Pick<WorkspaceBacking, 'getDocument' | 'commitPuts'>>().toMatchTypeOf<CaptureAcceptBacking>();
    const ctx = service();
    expect(ctx.backing.trace).toEqual([]);
    expect(ctx.backing.getDocument).not.toHaveBeenCalled();
    expect(ctx.backing.commitPuts).not.toHaveBeenCalled();
    expect(ctx.now).not.toHaveBeenCalled();
  });

  it('reads authoritative evidence and atomically saves only the exact binding and operation pair', async () => {
    const ctx = seeded();
    const originalReceipt = copy(ctx.backing.documents.get(receiptKey));
    const result = await ctx.api.accept(request());
    expect(result).toEqual({ status: 'saved', result: {
      schema: 'hq.design.capture-binding/v1', workspace: 'hq-local', ...request(), versionId, boundAt: time,
    } });
    expect(ctx.backing.trace).toEqual([`read:${operationKey}`, `read:${receiptKey}`, 'clock', 'commit']);
    expect(ctx.backing.commitPuts).toHaveBeenCalledTimes(1);
    const pair = ctx.backing.batches[0];
    expect(pair.map(put => [put.key, put.expectedRevision])).toEqual([[bindingKey, null], [operationKey, null]]);
    expect(decodeCaptureBinding(pair[0].value)).toEqual('result' in result ? result.result : null);
    expect(decodeCaptureOperation(pair[1].value).result).toEqual(pair[0].value);
    expect([...ctx.backing.documents.keys()].sort()).toEqual([bindingKey, operationKey, receiptKey].sort());
    expect(ctx.backing.documents.get(receiptKey)).toEqual(originalReceipt);
    expect(ctx.backing.visiblePairs).toEqual([[false, false], [true, true]]);
  });

  it('reconstructs from the stored operation without receipt reads, clock calls or writes', async () => {
    const ctx = seeded();
    const saved = await ctx.api.accept(request());
    const operation = copy(ctx.backing.documents.get(operationKey)!.value);
    const next = service(ctx.backing);
    next.backing.getDocument.mockClear();
    next.backing.commitPuts.mockClear();
    next.backing.getDocument.mockImplementation(async key => {
      if (key !== operationKey) throw Error('Receipt read forbidden');
      return copy(next.backing.documents.get(key)!);
    });
    next.now.mockImplementation(() => { throw Error('Clock forbidden'); });
    expect(await next.api.accept(request())).toEqual({ status: 'replayed',
      result: 'result' in saved ? saved.result : null, operation });
    expect(next.backing.getDocument).toHaveBeenCalledExactlyOnceWith(operationKey);
    expect(next.now).not.toHaveBeenCalled();
    expect(next.backing.commitPuts).not.toHaveBeenCalled();
  });

  it('conflicts on a changed payload with the same operation before receipt or clock work', async () => {
    const ctx = seeded();
    await ctx.api.accept(request());
    for (const field of ['projectId', 'viewId', 'captureId', 'receiptDigest', 'captureDigest', 'versionDigest'] as const) {
      const next = service(ctx.backing);
      next.backing.getDocument.mockClear();
      next.backing.commitPuts.mockClear();
      expect(await next.api.accept({ ...request(), [field]: field.endsWith('Digest') ? otherDigest : 'other' }))
        .toEqual({ status: 'conflict', reason: 'operation-id-reused' });
      expect(next.backing.getDocument).toHaveBeenCalledExactlyOnceWith(operationKey);
      expect(next.now).not.toHaveBeenCalled();
      expect(next.backing.commitPuts).not.toHaveBeenCalled();
    }
  });

  it('rejects invalid requests and caller receipt shortcuts before any I/O', async () => {
    for (const input of [null, {}, { ...request(), operationId: 'A' }, { ...request(), projectId: 'hq-local' },
      { ...request(), captureDigest: 'bad' }, { ...request(), versionId }, { ...request(), receipt: receipt() }]) {
      const ctx = seeded();
      expect(await ctx.api.accept(input)).toMatchObject({ status: 'invalid' });
      expect(ctx.backing.trace).toEqual([]);
    }
  });

  it('never writes for missing, invalid or mismatched authoritative receipts and digests', async () => {
    const changed = { ...receipt(), scroll: { x: 0.2, y: 1e-7 } };
    const cases: readonly [unknown | null, unknown][] = [
      [null, request()], [{}, request()], [{ ...receipt(), extra: true }, request()],
      [{ ...receipt(), captureId: 'different' }, request()],
      [{ ...receipt(), captureId: 'different' }, request({ ...receipt(), captureId: 'different' })], [changed, request()],
      [receipt(), { ...request(), receiptDigest: otherDigest }],
      [receipt(), { ...request(), captureDigest: otherDigest }],
      [{ ...receipt(), image: { ...receipt().image, digest: otherDigest } }, request()],
    ];
    for (const [value, input] of cases) {
      const ctx = service();
      if (value !== null) ctx.backing.seed(receiptKey, 1, value);
      expect(await ctx.api.accept(input)).toMatchObject({ status: 'invalid' });
      expect(ctx.now).not.toHaveBeenCalled();
      expect(ctx.backing.commitPuts).not.toHaveBeenCalled();
      expect(ctx.backing.documents.has(bindingKey)).toBe(false);
      expect(ctx.backing.documents.has(operationKey)).toBe(false);
    }
  });

  it('checks authoritative document keys and revisions, including on replay', async () => {
    const saved = seeded();
    await saved.api.accept(request());
    const storedOperation = saved.backing.documents.get(operationKey)!.value;
    for (const key of [operationKey, receiptKey]) {
      for (const bad of [{ key: 'wrong', revision: 1 }, ...[0, -1, 1.5, NaN, Infinity, '1', Number.MAX_SAFE_INTEGER + 1]
        .map(revision => ({ key, revision }))]) {
        const ctx = seeded();
        ctx.backing.getDocument.mockImplementation(async requested => requested === key
          ? { ...bad, value: key === operationKey ? storedOperation : receipt() } as CaptureDocument
          : null);
        expect(await ctx.api.accept(request())).toMatchObject({ status: 'invalid' });
        expect(ctx.now).not.toHaveBeenCalled();
        expect(ctx.backing.commitPuts).not.toHaveBeenCalled();
      }
    }
    for (const value of [{}, { status: 'unknown' }, { ...decodeCaptureOperation(storedOperation), requestDigest: otherDigest }]) {
      const ctx = seeded();
      ctx.backing.seed(operationKey, 1, value);
      expect(await ctx.api.accept(request())).toMatchObject({ status: 'invalid' });
      expect(ctx.backing.trace).toEqual([`read:${operationKey}`]);
    }
  });

  it('reports unknown read outcomes explicitly and never retries or writes', async () => {
    for (const phase of ['operation-read', 'receipt-read'] as const) {
      const ctx = seeded();
      const read = ctx.backing.getDocument.getMockImplementation()!;
      ctx.backing.getDocument.mockImplementation(async key => {
        if (key === (phase === 'operation-read' ? operationKey : receiptKey)) throw Error('Read outcome unavailable');
        return read(key);
      });
      expect(await ctx.api.accept(request())).toEqual({ status: 'unknown', phase });
      expect(ctx.backing.getDocument).toHaveBeenCalledTimes(phase === 'operation-read' ? 1 : 2);
      expect(ctx.now).not.toHaveBeenCalled();
      expect(ctx.backing.commitPuts).not.toHaveBeenCalled();
    }
  });

  it('fails before commit on a throwing or invalid clock', async () => {
    for (const clock of [() => { throw Error('Clock unavailable'); }, () => 'invalid']) {
      const ctx = seeded();
      const api = createCaptureAcceptService({ backing: ctx.backing, now: clock });
      expect(await api.accept(request())).toMatchObject({ status: 'invalid' });
      expect(ctx.backing.commitPuts).not.toHaveBeenCalled();
      expect(ctx.backing.documents.size).toBe(1);
    }
  });

  it('preserves planner eligibility distinctions without adding attestation policy or materializing versions', async () => {
    for (const mode of ['production', 'qualification'] as const) {
      const value = { ...receipt(), producer: { ...receipt().producer, mode },
        fixture: { state: 'unknown' as const, attestedBy: null }, imageRectCss: { ...receipt().imageRectCss, x: 1 } };
      const ctx = seeded(value);
      const eligibility = staticCaptureEligible(value);
      expect(eligibility.eligible).toBe(false);
      expect(await ctx.api.accept(request(value))).toMatchObject({ status: 'saved', result: { versionId } });
      expect(staticCaptureEligible(value)).toEqual(eligibility);
      expect([...ctx.backing.documents.keys()].sort()).toEqual([bindingKey, operationKey, receiptKey].sort());
    }
  });

  it('refuses a duplicate binding under a different operation with no partial operation visibility', async () => {
    const ctx = seeded();
    await ctx.api.accept(request());
    const before = copy([...ctx.backing.documents]);
    expect(await ctx.api.accept({ ...request(), operationId: 'accept-2' }))
      .toEqual({ status: 'refused', reason: 'commit-conflict' });
    expect([...ctx.backing.documents]).toEqual(before);
    expect(ctx.backing.documents.has(captureOperationKey('accept-2'))).toBe(false);
    expect(ctx.backing.batches[1].every(put => put.expectedRevision === null)).toBe(true);
  });

  it('resolves concurrent create-only races with one atomic winner and no automatic retry', async () => {
    for (const sameOperation of [true, false]) {
      const ctx = seeded();
      const secondRequest = { ...request(), operationId: sameOperation ? 'accept-1' : 'accept-2' };
      const results = await Promise.all([ctx.api.accept(request()), service(ctx.backing).api.accept(secondRequest)]);
      expect(results.map(result => result.status).sort()).toEqual(['refused', 'saved']);
      expect(ctx.backing.commitPuts).toHaveBeenCalledTimes(2);
      expect(ctx.backing.documents.size).toBe(3);
      expect(ctx.backing.documents.has(bindingKey)).toBe(true);
      const operation = decodeCaptureOperation(ctx.backing.documents.get(operationKey)!.value);
      expect(operation.result).toEqual(ctx.backing.documents.get(bindingKey)!.value);
      expect(ctx.backing.visiblePairs).toEqual([[false, false], [true, true], sameOperation ? [true, true] : [true, false]]);
    }
  });

  it('leaves the binding absent when the second create-only key races into existence', async () => {
    const ctx = seeded();
    const competingValue = { occupied: true };
    ctx.now.mockImplementation(() => {
      ctx.backing.seed(operationKey, 1, competingValue);
      return time;
    });
    expect(await ctx.api.accept(request())).toEqual({ status: 'refused', reason: 'commit-conflict' });
    expect(ctx.backing.documents.has(bindingKey)).toBe(false);
    expect(ctx.backing.documents.get(operationKey)!.value).toEqual(competingValue);
    expect(ctx.backing.commitPuts).toHaveBeenCalledTimes(1);
    expect(ctx.backing.visiblePairs).toEqual([[false, true]]);
  });

  it('distinguishes real-shaped StoreError refusal from other thrown commit outcomes', async () => {
    for (const error of [conflict(), Error('Transport lost'), Object.assign(Error('Other error'), { code: 'conflict' }),
      Object.assign(Error('Unavailable'), { name: 'StoreError', code: 'unavailable' })]) {
      const ctx = seeded();
      ctx.backing.commitPuts.mockRejectedValue(error);
      expect(await ctx.api.accept(request())).toEqual(error.name === 'StoreError' && 'code' in error && error.code === 'conflict'
        ? { status: 'refused', reason: 'commit-conflict' } : { status: 'unknown', phase: 'commit' });
      expect(ctx.backing.commitPuts).toHaveBeenCalledTimes(1);
      expect(ctx.backing.getDocument).toHaveBeenCalledTimes(2);
      expect(ctx.backing.documents.size).toBe(1);
    }
  });

  it('replays a later explicit invocation after atomic commit loses its acknowledgment', async () => {
    const ctx = seeded();
    const commit = ctx.backing.commitPuts.getMockImplementation()!;
    ctx.backing.commitPuts.mockImplementationOnce(async puts => { await commit(puts); throw Error('Ack lost'); });
    expect(await ctx.api.accept(request())).toEqual({ status: 'unknown', phase: 'commit' });
    expect(ctx.backing.visiblePairs).toEqual([[false, false], [true, true]]);
    const next = service(ctx.backing);
    expect(await next.api.accept(request())).toMatchObject({ status: 'replayed', result: { versionId, boundAt: time } });
    expect(next.now).not.toHaveBeenCalled();
    expect(ctx.backing.commitPuts).toHaveBeenCalledTimes(1);
  });

  it('treats malformed, partial, duplicate, wrong-key, wrong-revision and changed-value acks as unknown', async () => {
    const corruptions: ((pair: readonly CaptureDocument[]) => unknown)[] = [
      () => undefined, () => null, () => ({}), () => [], pair => pair.slice(0, 1),
      pair => [pair[0], pair[0]], pair => [...pair, pair[0]],
      pair => [{ ...pair[0], key: 'wrong' }, pair[1]], pair => [pair[0], null],
      ...[0, 2, -1, 1.5, NaN, Infinity, '1'].map(revision => (pair: readonly CaptureDocument[]) => [{ ...pair[0], revision }, pair[1]]),
      pair => [pair[0], { ...pair[1], value: {} }],
      pair => [{ ...pair[0], value: { ...decodeCaptureBinding(pair[0].value), boundAt: '2026-11-02T00:00:04Z' } }, pair[1]],
    ];
    for (const corrupt of corruptions) {
      const ctx = seeded();
      const commit = ctx.backing.commitPuts.getMockImplementation()!;
      ctx.backing.commitPuts.mockImplementationOnce(async puts => corrupt(await commit(puts)) as readonly CaptureDocument[]);
      expect(await ctx.api.accept(request())).toEqual({ status: 'unknown', phase: 'commit' });
      expect(ctx.backing.commitPuts).toHaveBeenCalledTimes(1);
      expect(ctx.backing.getDocument).toHaveBeenCalledTimes(2);
      expect(ctx.backing.visiblePairs).toEqual([[false, false], [true, true]]);
    }
  });

  it('accepts reordered canonical acknowledgments but rejects mutation of the submitted expectations', async () => {
    const ctx = seeded();
    const commit = ctx.backing.commitPuts.getMockImplementation()!;
    ctx.backing.commitPuts.mockImplementationOnce(async puts => (await commit(puts)).map(doc => ({ ...doc,
      value: Object.fromEntries(Object.entries(doc.value as object).reverse()) })).reverse());
    expect(await ctx.api.accept(request())).toMatchObject({ status: 'saved' });
    const next = seeded();
    next.backing.commitPuts.mockImplementationOnce(async puts => {
      const changed = puts[0].value as Record<string, unknown>;
      changed.boundAt = '2026-11-02T00:00:04Z';
      return puts.map(put => ({ key: put.key, revision: 1, value: put.value }));
    });
    expect(await next.api.accept(request())).toEqual({ status: 'unknown', phase: 'commit' });
  });
});
