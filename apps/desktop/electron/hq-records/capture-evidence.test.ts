import { describe, expect, it } from 'vitest';
import { canonicalJson, ContractError, type Digest } from './canonical.js';
import {
  captureAcceptRequestDigest, captureBindingDigest, captureOperationDigest, captureReceiptDigest, captureTupleHex, captureVersionId,
  decodeCaptureBinding, decodeCaptureOperation, decodeCaptureReceipt, encodeCaptureBinding, encodeCaptureOperation, encodeCaptureReceipt,
  normalizeCaptureAcceptRequest, planCaptureAccept, staticCaptureEligible,
  type CaptureAcceptOperation, type CaptureAcceptRequest, type CaptureBinding, type CaptureReceipt,
} from './capture-evidence.js';
import { captureBindingKey, captureOperationKey, captureReceiptKey, encodedStoreName } from './keys.js';
import { decodeOperation } from './projects-registry.js';

const receiptDigest: Digest = 'sha256:4fac383be73be1e6b1095dfc528036c8c65e0d67491b5e39e2eae9bf717a4ae8';
const requestDigest: Digest = 'sha256:43495a642aa8202c688eb789c34d23a82b44864c3b72c1084b0fea9c09994a12';
const versionId = 'vcap-c6382ed815646bd6fdec00b2b950eaea8f8c8c2f';
const tupleHex = '11afb78d0ebc38cb2df961c563fba0007d35b462413967fd3e2e9c489fb5976c';
const boundAt = '2026-11-02T00:00:03Z';

// Synthetic codec input only; these fields do not prove a real producer attested anything.
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

function request(): CaptureAcceptRequest {
  return { operationId: 'accept-1', projectId: 'project-1', viewId: 'view-1', captureId: 'capture-1',
    receiptDigest, captureDigest: `sha256:${'a'.repeat(64)}`, versionDigest: `sha256:${'b'.repeat(64)}` };
}

function binding(): CaptureBinding {
  return { schema: 'hq.design.capture-binding/v1', workspace: 'hq-local', ...request(), versionId, boundAt };
}

function operation(): CaptureAcceptOperation {
  return { schema: 'hq.design.capture-accept-operation/v1', operationId: 'accept-1', kind: 'accept-capture',
    requestDigest, result: binding(), committedAt: boundAt };
}

function context() {
  return { receipt: { digest: receiptDigest, value: receipt() }, operation: { status: 'absent' as const }, now: () => boundAt };
}

function change(value: unknown, path: readonly string[], replacement: unknown, remove = false): unknown {
  const result: unknown = structuredClone(value);
  let target = result as Record<string, unknown>;
  for (const key of path.slice(0, -1)) target = target[key] as Record<string, unknown>;
  const key = path[path.length - 1];
  if (remove) delete target[key];
  else target[key] = replacement;
  return result;
}

describe('inert CAP-1 receipt codecs', () => {
  it('pins independent receipt, binding, operation and request golden digests', () => {
    expect(captureReceiptDigest(receipt())).toBe(receiptDigest);
    expect(captureAcceptRequestDigest(request())).toBe(requestDigest);
    expect(captureBindingDigest(binding())).toBe('sha256:b35045a21fe9ce88394808fbce9515228dffc0ffce3cd1324d26f79f1d7f81b8');
    expect(captureOperationDigest(operation())).toBe('sha256:94b8a99e60a03bb7b298ee5b642c11407f36a8666f098e60c4a4c48e504f5b3f');
    for (const [value, encode, decode] of [
      [receipt(), encodeCaptureReceipt, decodeCaptureReceipt],
      [binding(), encodeCaptureBinding, decodeCaptureBinding],
      [operation(), encodeCaptureOperation, decodeCaptureOperation],
    ] as const) expect(decode(JSON.parse(encode(value)))).toEqual(value);
    expect(encodeCaptureReceipt(receipt())).toContain('"scroll":{"x":0.1,"y":1e-7}');
    expect(encodeCaptureBinding(binding())).toBe(canonicalJson(binding()));
    expect(encodeCaptureOperation(operation())).toBe(canonicalJson(operation()));
  });

  it('preserves rounding-sensitive observed doubles as numbers, including tiny positive extents', () => {
    const source = { ...receipt(), viewport: { w: 123.456, h: 0.5, dpr: 2 as const },
      scroll: { x: 0.30000000000000004, y: 1e-7 },
      pageExtentCss: { width: 123.45600000000002, height: 1e-7 },
      imageRectCss: { x: 0.1, y: 0.5, width: 123.456, height: 1e-7 } };
    const decoded = decodeCaptureReceipt(JSON.parse(encodeCaptureReceipt(source)));
    expect(decoded).toEqual(source);
    expect(Object.is(decoded.scroll.x, 0.30000000000000004)).toBe(true);
    expect(Object.is(decoded.pageExtentCss.width, 123.45600000000002)).toBe(true);
    expect(captureReceiptDigest(source)).not.toBe(captureReceiptDigest({ ...source, scroll: { ...source.scroll, x: 0.3 } }));
    expect(captureReceiptDigest(source)).not.toBe(captureReceiptDigest({ ...source, pageExtentCss: { ...source.pageExtentCss, width: 123.456 } }));
    expect(decodeCaptureReceipt({ ...receipt(), time: { ...receipt().time, acquisition: null } }).time.acquisition).toBeNull();
  });

  it('closes every receipt record, including fixture and nullable acquisition, without defaults', () => {
    for (const path of [[], ['producer'], ['host'], ['page'], ['viewport'], ['scroll'], ['pageExtentCss'],
      ['imageRectCss'], ['image'], ['time'], ['time', 'acquisition'], ['fixture']]) {
      let target = receipt() as unknown as Record<string, unknown>;
      for (const key of path) target = target[key] as Record<string, unknown>;
      expect(() => decodeCaptureReceipt(change(receipt(), [...path, 'unknown'], undefined))).toThrow(ContractError);
      for (const key of Object.keys(target)) {
        expect(() => decodeCaptureReceipt(change(receipt(), [...path, key], undefined, true))).toThrow(ContractError);
      }
    }
    expect(() => decodeCaptureReceipt(change(receipt(), ['fixture', 'attestedBy'], null))).toThrow(ContractError);
    expect(() => decodeCaptureReceipt(change(receipt(), ['fixture', 'state'], 'absent'))).toThrow(ContractError);
    expect(() => decodeCaptureReceipt(change(receipt(), ['fixture', 'attestedBy'], 'ci'))).toThrow(ContractError);
    const accessor = Object.defineProperty(receipt(), 'fixture', { enumerable: true, get() { throw Error('getter ran'); } });
    expect(() => decodeCaptureReceipt(accessor)).toThrow(ContractError);
  });

  it('refuses nonfinite, negative-zero, negative and oversized geometry at every numeric seam', () => {
    const paths = [['viewport', 'w'], ['viewport', 'h'], ['scroll', 'x'], ['scroll', 'y'],
      ['pageExtentCss', 'width'], ['pageExtentCss', 'height'], ['imageRectCss', 'x'], ['imageRectCss', 'y'],
      ['imageRectCss', 'width'], ['imageRectCss', 'height']];
    for (const path of paths) {
      for (const value of [NaN, Infinity, -Infinity, -0, -0.1, 10_000_000.000000002, '0.5']) {
        expect(() => decodeCaptureReceipt(change(receipt(), path, value))).toThrow(ContractError);
      }
      expect(() => decodeCaptureReceipt(change(receipt(), path, 10_000_000))).not.toThrow();
      const origin = path[0] === 'scroll' || (path[0] === 'imageRectCss' && ['x', 'y'].includes(path[1]));
      if (origin) expect(() => decodeCaptureReceipt(change(receipt(), path, 0))).not.toThrow();
      else expect(() => decodeCaptureReceipt(change(receipt(), path, 0))).toThrow(ContractError);
    }
    for (const dpr of [0, -0, 0.5, 4, '1', NaN]) expect(() => decodeCaptureReceipt(change(receipt(), ['viewport', 'dpr'], dpr))).toThrow();
  });

  it('refuses invalid integer, digest, producer, transient ID, page and timestamp fields', () => {
    for (const path of [['image', 'byteLength'], ['image', 'pixelWidth'], ['image', 'pixelHeight']]) {
      for (const value of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1920']) {
        expect(() => decodeCaptureReceipt(change(receipt(), path, value))).toThrow();
      }
    }
    for (const [path, values] of [
      [['schema'], ['hq.design.capture-evidence/v2']], [['captureId'], ['A', 'a/b', 'a'.repeat(65)]],
      [['producer', 'id'], ['renderer']], [['producer', 'contract'], [2]], [['producer', 'mode'], ['ci']],
      [['producer', 'packaged'], [1]], [['producer', 'appVersion'], ['', 'a'.repeat(161)]],
      [['host', 'sessionId'], ['', 's'.repeat(101)]], [['host', 'hostVersionId'], ['', 'v'.repeat(301)]],
      [['host', 'generation'], [-1, 0.1, Number.MAX_SAFE_INTEGER + 1]],
      [['page', 'origin'], ['null', 'https://example.com/path', 'https://user@example.com']],
      [['page', 'route'], ['', '//other', '/a#fragment', '/a\\b']], [['page', 'state'], ['plain', 'x'.repeat(2049)]],
      [['image', 'mediaType'], ['image/jpeg']], [['image', 'digest'], ['a'.repeat(64), `sha256:${'A'.repeat(64)}`]],
      [['time', 'basis'], ['renderer-clock']], [['time', 'capturedAt'], ['2026-02-29T00:00:00Z', '2026-11-02T00:00:00']],
      [['time', 'acquisition', 'end'], ['2026-11-02T24:00:00Z']], [['persistedAt'], ['2026-11-02T00:00:60Z']],
    ] as const) for (const value of values) expect(() => decodeCaptureReceipt(change(receipt(), path, value))).toThrow();
    expect(decodeCaptureReceipt(change(receipt(), ['page', 'state'], '#observed')).page.state).toBe('#observed');
    expect(decodeCaptureReceipt(change(receipt(), ['persistedAt'], '2024-02-29T23:59:59.123456789-05:00')).persistedAt)
      .toBe('2024-02-29T23:59:59.123456789-05:00');
  });
});

describe('static capture eligibility consumes explicit evidence', () => {
  it('requires production, explicitly attested known absence and exact full extent in every combination', () => {
    for (const mode of ['production', 'qualification'] as const) for (const state of ['known-absent', 'known-present', 'unknown'] as const) {
      for (const full of [true, false]) {
        const source = receipt();
        const value = { ...source, producer: { ...source.producer, mode }, fixture: { ...source.fixture, state },
          imageRectCss: { ...source.imageRectCss, width: full ? source.pageExtentCss.width : source.pageExtentCss.width - 1e-7 } };
        const reason = mode !== 'production' ? 'not-production' : state === 'unknown' ? 'fixture-unknown'
          : state === 'known-present' ? 'fixture-present' : !full ? 'partial-extent' : null;
        expect(staticCaptureEligible(value)).toEqual(reason === null ? { eligible: true } : { eligible: false, reason });
      }
    }
    for (const state of ['unknown', 'known-present'] as const) {
      expect(staticCaptureEligible({ ...receipt(), fixture: { state, attestedBy: null } }))
        .toEqual({ eligible: false, reason: state === 'unknown' ? 'fixture-unknown' : 'fixture-present' });
    }
  });

  it('uses exact rectangle equality with no rounding or pixel/digest/capture-ID inference', () => {
    for (const [field, value] of [['x', 1e-7], ['y', 1e-7], ['width', 1920.5000000000002], ['height', 1080.2500000000002]] as const) {
      expect(staticCaptureEligible(change(receipt(), ['imageRectCss', field], value))).toEqual({ eligible: false, reason: 'partial-extent' });
    }
    for (const captureId of ['fixture', 'production', 'ci', 'qualification']) for (const packaged of [true, false]) {
      const source = { ...receipt(), captureId, producer: { ...receipt().producer, packaged },
        image: { ...receipt().image, digest: `sha256:${'0'.repeat(64)}` as Digest, pixelWidth: 1, pixelHeight: 1 } };
      expect(staticCaptureEligible(source)).toEqual({ eligible: true });
      expect(staticCaptureEligible({ ...source, fixture: { state: 'unknown', attestedBy: null } }))
        .toEqual({ eligible: false, reason: 'fixture-unknown' });
      expect(staticCaptureEligible({ ...source, fixture: { state: 'known-present', attestedBy: null } }))
        .toEqual({ eligible: false, reason: 'fixture-present' });
    }
  });
});

describe('capture binding and accept-operation planning', () => {
  it('pins CAP-1 original preimages, derived IDs and create-only keys', () => {
    expect(canonicalJson({ kind: 'hq.design.capture-version/v1', captureId: 'capture-1', projectId: 'project-1', viewId: 'view-1' }))
      .toBe('{"captureId":"capture-1","kind":"hq.design.capture-version/v1","projectId":"project-1","viewId":"view-1"}');
    expect(captureVersionId('project-1', 'view-1', 'capture-1')).toBe(versionId);
    expect(captureTupleHex('project-1', 'view-1', versionId)).toBe(tupleHex);
    const planned = planCaptureAccept(request(), context());
    expect(planned.status).toBe('planned');
    if (planned.status !== 'planned') throw Error('Expected a pure plan');
    expect(planned.result).toEqual(binding());
    expect(planned.requestDigest).toBe(requestDigest);
    expect(planned.puts).toEqual([
      { key: `hq/captures/bindings/${tupleHex}`, expectedRevision: null, value: binding() },
      { key: 'hq/captures/operations/accept-1', expectedRevision: null, value: operation() },
    ]);
    expect(request()).not.toHaveProperty('versionId');
    expect(request()).not.toHaveProperty('boundAt');
    for (const key of [captureReceiptKey('a'.repeat(64)), captureBindingKey(tupleHex), captureOperationKey('a'.repeat(64))]) {
      expect(encodedStoreName(key).length).toBeLessThan(180);
    }
    expect(captureVersionId('project-2', 'view-1', 'capture-1')).not.toBe(versionId);
    expect(captureVersionId('project-1', 'view-2', 'capture-1')).not.toBe(versionId);
    expect(captureVersionId('project-1', 'view-1', 'capture-2')).not.toBe(versionId);
  });

  it('keeps request, binding, operation and nested result closed and mutually refuses create operations', () => {
    for (const [value, decode] of [[request(), normalizeCaptureAcceptRequest], [binding(), decodeCaptureBinding],
      [operation(), decodeCaptureOperation]] as const) {
      expect(() => decode({ ...value, unknown: undefined })).toThrow(ContractError);
      for (const key of Object.keys(value)) expect(() => decode(change(value, [key], undefined, true))).toThrow(ContractError);
    }
    for (const key of Object.keys(binding())) expect(() => decodeCaptureOperation(change(operation(), ['result', key], undefined, true))).toThrow();
    expect(() => decodeCaptureOperation(change(operation(), ['result', 'extra'], true))).toThrow();
    expect(() => decodeCaptureOperation(change(operation(), ['operationId'], 'different'))).toThrow();
    expect(() => decodeCaptureOperation(change(operation(), ['requestDigest'], `sha256:${'0'.repeat(64)}`))).toThrow();
    expect(() => decodeCaptureOperation(change(operation(), ['committedAt'], '2026-11-02T00:00:04Z'))).toThrow();
    const create = { schema: 'hq.projects.operation/v1', operationId: 'create-1', kind: 'create',
      requestDigest, result: { projectId: 'project-1' }, committedAt: boundAt };
    expect(() => decodeCaptureOperation(create)).toThrow(ContractError);
    expect(() => decodeOperation(operation())).toThrow(ContractError);
    expect(decodeOperation(create)).toEqual(create);
    for (const [field, value] of [['workspace', 'other'], ['projectId', 'hq-local'], ['projectId', ' x'], ['viewId', ''],
      ['viewId', 'v'.repeat(161)], ['versionId', 'caller-chosen'], ['captureId', 'A'], ['operationId', 'a/b'],
      ['receiptDigest', 'bad'], ['captureDigest', 'bad'], ['versionDigest', 'bad'], ['boundAt', 'invalid']] as const) {
      expect(() => decodeCaptureBinding(change(binding(), [field], value))).toThrow();
    }
  });

  it('replays the recorded result without minting a new time or consulting a receipt', () => {
    const replay = planCaptureAccept(request(), { receipt: { digest: receiptDigest, value: null },
      operation: { status: 'present', value: operation() }, now: () => { throw Error('clock must not run'); } });
    expect(replay).toEqual({ status: 'replayed', result: binding(), operation: operation() });
    expect(replay).not.toHaveProperty('puts');
    for (const field of ['projectId', 'viewId', 'captureId', 'operationId', 'receiptDigest', 'captureDigest', 'versionDigest'] as const) {
      const value = field.endsWith('Digest') ? `sha256:${'0'.repeat(64)}` : 'different';
      expect(planCaptureAccept({ ...request(), [field]: value }, { ...context(), operation: { status: 'present', value: operation() } }))
        .toEqual({ status: 'conflict', reason: 'operation-id-reused' });
    }
  });

  it('returns unknown-outcome conflicts without trying a replacement operation or calling the clock', () => {
    let clockCalls = 0;
    const unknown = { ...context(), operation: { status: 'unknown' as const }, now: () => { clockCalls += 1; return boundAt; } };
    expect(planCaptureAccept(request(), unknown)).toEqual({ status: 'conflict', reason: 'operation-unknown' });
    expect(clockCalls).toBe(0);
    expect(planCaptureAccept(request(), { ...unknown, operation: { status: 'unknown', extra: true } } as typeof unknown).status).toBe('invalid');
  });

  it('refuses request-authored version/time and requires the supplied receipt to match every pin', () => {
    for (const extra of [{ versionId }, { boundAt }, { schema: 'extra' }]) {
      expect(planCaptureAccept({ ...request(), ...extra }, context()).status).toBe('invalid');
    }
    for (const key of Object.keys(request())) expect(planCaptureAccept(change(request(), [key], undefined, true), context()).status).toBe('invalid');
    for (const [field, value] of [['captureId', 'different'], ['receiptDigest', `sha256:${'0'.repeat(64)}`],
      ['captureDigest', `sha256:${'0'.repeat(64)}`], ['projectId', 'hq-local'], ['viewId', ''], ['operationId', 'A']] as const) {
      expect(planCaptureAccept({ ...request(), [field]: value }, context()).status).toBe('invalid');
    }
    expect(planCaptureAccept(request(), { ...context(), now: () => 'invalid' }).status).toBe('invalid');
    expect(planCaptureAccept(request(), { ...context(), receipt: { digest: requestDigest, value: receipt() } }).status).toBe('invalid');
    expect(planCaptureAccept(request(), { ...context(), receipt: { digest: receiptDigest, value: change(receipt(), ['scroll', 'x'], 0.2) } }).status).toBe('invalid');
    const later = planCaptureAccept(request(), { ...context(), now: () => '2026-11-02T00:00:04Z' });
    expect(later.status).toBe('planned');
    if (later.status !== 'planned') throw Error('Expected a pure plan');
    expect(later.result.boundAt).toBe('2026-11-02T00:00:04Z');
    expect(later.requestDigest).toBe(requestDigest);
    expect(later.result.versionId).toBe(versionId);
    expect(later.puts[0].key).toBe(captureBindingKey(tupleHex));
  });
});
