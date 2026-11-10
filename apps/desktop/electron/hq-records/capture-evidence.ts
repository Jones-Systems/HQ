import { createHash } from 'node:crypto';
import { canonicalDigest, canonicalFiniteDigest, canonicalFiniteJson, canonicalJson, closedRecord, ContractError, isDigest, type Digest } from './canonical.js';
import { captureBindingKey, captureOperationKey, opaqueSegment } from './keys.js';

export const CAPTURE_RECEIPT_SCHEMA = 'hq.design.capture-evidence/v1';
export const CAPTURE_BINDING_SCHEMA = 'hq.design.capture-binding/v1';
export const CAPTURE_OPERATION_SCHEMA = 'hq.design.capture-accept-operation/v1';

export interface CaptureReceipt {
  readonly schema: typeof CAPTURE_RECEIPT_SCHEMA;
  readonly captureId: string;
  readonly producer: { readonly id: 'hq.electron-preview'; readonly contract: 1; readonly mode: 'production' | 'qualification'; readonly appVersion: string; readonly packaged: boolean };
  readonly host: { readonly sessionId: string; readonly hostVersionId: string; readonly generation: number };
  readonly page: { readonly origin: string; readonly route: string; readonly state: string };
  readonly viewport: { readonly w: number; readonly h: number; readonly dpr: 1 | 2 | 3 };
  readonly scroll: { readonly x: number; readonly y: number };
  readonly pageExtentCss: { readonly width: number; readonly height: number };
  readonly imageRectCss: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly image: { readonly mediaType: 'image/png'; readonly digest: Digest; readonly byteLength: number; readonly pixelWidth: number; readonly pixelHeight: number };
  readonly time: { readonly capturedAt: string; readonly basis: 'host-clock-after-coherence-before-persist'; readonly acquisition: { readonly start: string; readonly end: string } | null };
  readonly persistedAt: string;
  readonly fixture: { readonly state: 'known-absent' | 'known-present' | 'unknown'; readonly attestedBy: 'hq.electron-preview/contract-1' | null };
}

export interface CaptureBinding {
  readonly schema: typeof CAPTURE_BINDING_SCHEMA;
  readonly workspace: 'hq-local';
  readonly projectId: string;
  readonly viewId: string;
  readonly versionId: string;
  readonly captureId: string;
  readonly receiptDigest: Digest;
  readonly captureDigest: Digest;
  readonly versionDigest: Digest;
  readonly operationId: string;
  readonly boundAt: string;
}

export interface CaptureAcceptRequest {
  readonly operationId: string;
  readonly projectId: string;
  readonly viewId: string;
  readonly captureId: string;
  readonly receiptDigest: Digest;
  readonly captureDigest: Digest;
  readonly versionDigest: Digest;
}

export interface CaptureAcceptOperation {
  readonly schema: typeof CAPTURE_OPERATION_SCHEMA;
  readonly operationId: string;
  readonly kind: 'accept-capture';
  readonly requestDigest: Digest;
  readonly result: CaptureBinding;
  readonly committedAt: string;
}

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ContractError(message);
}

function text(value: unknown, max: number, allowEmpty = false): string {
  requireValue(typeof value === 'string' && (allowEmpty || value.length > 0) && value.length <= max
    && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value), 'Invalid bounded text');
  return value;
}

function identity(value: unknown, project = false): string {
  const id = text(value, 160);
  requireValue(!project || id !== 'hq-local', 'Workspace scope is not a project ID');
  return id;
}

function integer(value: unknown, min: number): number {
  requireValue(typeof value === 'number' && Number.isSafeInteger(value) && value >= min, 'Invalid safe integer');
  return value;
}

function geometry(value: unknown, positive = false): number {
  requireValue(typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)
    && (positive ? value > 0 : value >= 0) && value <= 10_000_000, 'Invalid CSS geometry');
  return value;
}

function digest(value: unknown): Digest {
  requireValue(isDigest(value), 'Invalid SHA-256 digest');
  return value;
}

// Kept local to preserve the inert module's canonical/keys-only dependency boundary.
function timestamp(value: unknown): string {
  requireValue(typeof value === 'string', 'Invalid timestamp');
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  requireValue(match, 'Timestamp needs an explicit RFC 3339 offset');
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  requireValue(month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
    && Number(hourText) <= 23 && Number(minuteText) <= 59 && Number(secondText) <= 59
    && (zone === 'Z' || (Number(zone.slice(1, 3)) <= 23 && Number(zone.slice(4, 6)) <= 59)), 'Invalid calendar timestamp');
  return value;
}

export function decodeCaptureReceipt(value: unknown): CaptureReceipt {
  const r = closedRecord(value, ['schema', 'captureId', 'producer', 'host', 'page', 'viewport', 'scroll', 'pageExtentCss', 'imageRectCss', 'image', 'time', 'persistedAt', 'fixture']);
  requireValue(r.schema === CAPTURE_RECEIPT_SCHEMA, 'Invalid capture receipt schema');
  const p = closedRecord(r.producer, ['id', 'contract', 'mode', 'appVersion', 'packaged']);
  requireValue(p.id === 'hq.electron-preview' && p.contract === 1
    && (p.mode === 'production' || p.mode === 'qualification') && typeof p.packaged === 'boolean', 'Invalid capture producer');
  const h = closedRecord(r.host, ['sessionId', 'hostVersionId', 'generation']);
  const page = closedRecord(r.page, ['origin', 'route', 'state']);
  const origin = text(page.origin, 2048);
  requireValue(new URL(origin).origin === origin && origin !== 'null', 'Invalid observed origin');
  const route = text(page.route, 2048), state = text(page.state, 2048, true);
  requireValue(route.startsWith('/') && !route.startsWith('//') && !/[#\\]/u.test(route)
    && (state === '' || state.startsWith('#')), 'Invalid observed route/state');
  const v = closedRecord(r.viewport, ['w', 'h', 'dpr']);
  requireValue(v.dpr === 1 || v.dpr === 2 || v.dpr === 3, 'Invalid capture DPR');
  const s = closedRecord(r.scroll, ['x', 'y']);
  const extent = closedRecord(r.pageExtentCss, ['width', 'height']);
  const rect = closedRecord(r.imageRectCss, ['x', 'y', 'width', 'height']);
  const image = closedRecord(r.image, ['mediaType', 'digest', 'byteLength', 'pixelWidth', 'pixelHeight']);
  requireValue(image.mediaType === 'image/png', 'Invalid capture media type');
  const t = closedRecord(r.time, ['capturedAt', 'basis', 'acquisition']);
  requireValue(t.basis === 'host-clock-after-coherence-before-persist', 'Invalid capture clock basis');
  let acquisition: CaptureReceipt['time']['acquisition'] = null;
  if (t.acquisition !== null) {
    const a = closedRecord(t.acquisition, ['start', 'end']);
    acquisition = { start: timestamp(a.start), end: timestamp(a.end) };
  }
  const f = closedRecord(r.fixture, ['state', 'attestedBy']);
  requireValue((f.state === 'known-absent' || f.state === 'known-present' || f.state === 'unknown')
    && (f.attestedBy === null || f.attestedBy === 'hq.electron-preview/contract-1')
    && (f.state !== 'known-absent' || f.attestedBy !== null), 'Invalid fixture evidence');
  return {
    schema: CAPTURE_RECEIPT_SCHEMA, captureId: opaqueSegment(r.captureId),
    producer: { id: p.id, contract: p.contract, mode: p.mode, appVersion: text(p.appVersion, 160), packaged: p.packaged },
    host: { sessionId: text(h.sessionId, 100), hostVersionId: text(h.hostVersionId, 300), generation: integer(h.generation, 0) },
    page: { origin, route, state }, viewport: { w: geometry(v.w, true), h: geometry(v.h, true), dpr: v.dpr },
    scroll: { x: geometry(s.x), y: geometry(s.y) },
    pageExtentCss: { width: geometry(extent.width, true), height: geometry(extent.height, true) },
    imageRectCss: { x: geometry(rect.x), y: geometry(rect.y), width: geometry(rect.width, true), height: geometry(rect.height, true) },
    image: { mediaType: image.mediaType, digest: digest(image.digest), byteLength: integer(image.byteLength, 1),
      pixelWidth: integer(image.pixelWidth, 1), pixelHeight: integer(image.pixelHeight, 1) },
    time: { capturedAt: timestamp(t.capturedAt), basis: t.basis, acquisition }, persistedAt: timestamp(r.persistedAt),
    fixture: { state: f.state, attestedBy: f.attestedBy },
  };
}

export const encodeCaptureReceipt = (value: unknown): string => canonicalFiniteJson(decodeCaptureReceipt(value));
export const captureReceiptDigest = (value: unknown): Digest => canonicalFiniteDigest(decodeCaptureReceipt(value));

export function captureVersionId(projectId: unknown, viewId: unknown, captureId: unknown): string {
  const preimage = { kind: 'hq.design.capture-version/v1', captureId: opaqueSegment(captureId), projectId: identity(projectId, true), viewId: identity(viewId) };
  return `vcap-${createHash('sha256').update(canonicalJson(preimage)).digest('hex').slice(0, 40)}`;
}

export function captureTupleHex(projectId: unknown, viewId: unknown, versionId: unknown): string {
  return createHash('sha256').update(canonicalJson({ kind: 'hq.design.capture-binding-key/v1', workspace: 'hq-local',
    projectId: identity(projectId, true), viewId: identity(viewId), versionId: identity(versionId) })).digest('hex');
}

export function decodeCaptureBinding(value: unknown): CaptureBinding {
  const r = closedRecord(value, ['schema', 'workspace', 'projectId', 'viewId', 'versionId', 'captureId', 'receiptDigest', 'captureDigest', 'versionDigest', 'operationId', 'boundAt']);
  requireValue(r.schema === CAPTURE_BINDING_SCHEMA && r.workspace === 'hq-local', 'Invalid capture binding schema/scope');
  const projectId = identity(r.projectId, true), viewId = identity(r.viewId), captureId = opaqueSegment(r.captureId);
  const versionId = captureVersionId(projectId, viewId, captureId);
  requireValue(r.versionId === versionId, 'Capture version ID does not match its tuple');
  return { schema: CAPTURE_BINDING_SCHEMA, workspace: 'hq-local', projectId, viewId, versionId, captureId,
    receiptDigest: digest(r.receiptDigest), captureDigest: digest(r.captureDigest), versionDigest: digest(r.versionDigest),
    operationId: opaqueSegment(r.operationId), boundAt: timestamp(r.boundAt) };
}

export const encodeCaptureBinding = (value: unknown): string => canonicalJson(decodeCaptureBinding(value));
export const captureBindingDigest = (value: unknown): Digest => canonicalDigest(decodeCaptureBinding(value));

export function normalizeCaptureAcceptRequest(value: unknown): CaptureAcceptRequest {
  const r = closedRecord(value, ['operationId', 'projectId', 'viewId', 'captureId', 'receiptDigest', 'captureDigest', 'versionDigest']);
  return { operationId: opaqueSegment(r.operationId), projectId: identity(r.projectId, true), viewId: identity(r.viewId),
    captureId: opaqueSegment(r.captureId), receiptDigest: digest(r.receiptDigest), captureDigest: digest(r.captureDigest), versionDigest: digest(r.versionDigest) };
}

export const captureAcceptRequestDigest = (value: unknown): Digest => canonicalDigest(normalizeCaptureAcceptRequest(value));

export function decodeCaptureOperation(value: unknown): CaptureAcceptOperation {
  const r = closedRecord(value, ['schema', 'operationId', 'kind', 'requestDigest', 'result', 'committedAt']);
  requireValue(r.schema === CAPTURE_OPERATION_SCHEMA && r.kind === 'accept-capture', 'Invalid capture accept operation');
  const result = decodeCaptureBinding(r.result), operationId = opaqueSegment(r.operationId), committedAt = timestamp(r.committedAt);
  requireValue(result.operationId === operationId && result.boundAt === committedAt, 'Capture operation and result disagree');
  const { projectId, viewId, captureId, receiptDigest, captureDigest, versionDigest } = result;
  const requestDigest = captureAcceptRequestDigest({ operationId, projectId, viewId, captureId, receiptDigest, captureDigest, versionDigest });
  requireValue(digest(r.requestDigest) === requestDigest, 'Capture operation request digest disagrees');
  return { schema: CAPTURE_OPERATION_SCHEMA, operationId, kind: 'accept-capture', requestDigest, result, committedAt };
}

export const encodeCaptureOperation = (value: unknown): string => canonicalJson(decodeCaptureOperation(value));
export const captureOperationDigest = (value: unknown): Digest => canonicalDigest(decodeCaptureOperation(value));

export type StaticCaptureEligibility = { readonly eligible: true }
  | { readonly eligible: false; readonly reason: 'not-production' | 'fixture-unknown' | 'fixture-present' | 'partial-extent' };

// This predicate consumes evidence; decoding a synthetic receipt issues no host attestation.
export function staticCaptureEligible(value: unknown): StaticCaptureEligibility {
  const receipt = decodeCaptureReceipt(value);
  if (receipt.producer.mode !== 'production') return { eligible: false, reason: 'not-production' };
  if (receipt.fixture.state === 'unknown') return { eligible: false, reason: 'fixture-unknown' };
  if (receipt.fixture.state === 'known-present') return { eligible: false, reason: 'fixture-present' };
  const rect = receipt.imageRectCss, extent = receipt.pageExtentCss;
  if (rect.x !== 0 || rect.y !== 0 || rect.width !== extent.width || rect.height !== extent.height) {
    return { eligible: false, reason: 'partial-extent' };
  }
  return { eligible: true };
}

export type CaptureOperationObservation = { readonly status: 'absent' } | { readonly status: 'unknown' }
  | { readonly status: 'present'; readonly value: unknown };
export interface CapturePut<T> { readonly key: string; readonly expectedRevision: null; readonly value: T }
export type CaptureAcceptPlan =
  | { readonly status: 'invalid'; readonly reason: string }
  | { readonly status: 'conflict'; readonly reason: 'operation-unknown' | 'operation-id-reused' }
  | { readonly status: 'replayed'; readonly result: CaptureBinding; readonly operation: CaptureAcceptOperation }
  | { readonly status: 'planned'; readonly result: CaptureBinding; readonly requestDigest: Digest;
    readonly puts: readonly [CapturePut<CaptureBinding>, CapturePut<CaptureAcceptOperation>] };

// The caller supplies a receipt observed at its digest. No read or persistence occurs here.
export function planCaptureAccept(request: unknown, context: {
  readonly receipt: { readonly digest: Digest; readonly value: unknown };
  readonly operation: CaptureOperationObservation;
  readonly now: () => unknown;
}): CaptureAcceptPlan {
  try {
    const normalized = normalizeCaptureAcceptRequest(request), requestDigest = captureAcceptRequestDigest(normalized);
    const observation = context.operation;
    if (observation.status === 'unknown') {
      closedRecord(observation, ['status']);
      return { status: 'conflict', reason: 'operation-unknown' };
    }
    if (observation.status === 'present') {
      closedRecord(observation, ['status', 'value']);
      const operation = decodeCaptureOperation(observation.value);
      if (operation.operationId !== normalized.operationId || operation.requestDigest !== requestDigest) {
        return { status: 'conflict', reason: 'operation-id-reused' };
      }
      return { status: 'replayed', result: operation.result, operation };
    }
    closedRecord(observation, ['status']);
    requireValue(observation.status === 'absent', 'Invalid capture operation observation');
    const supplied = closedRecord(context.receipt, ['digest', 'value']), receipt = decodeCaptureReceipt(supplied.value);
    requireValue(supplied.digest === normalized.receiptDigest && captureReceiptDigest(receipt) === normalized.receiptDigest
      && receipt.captureId === normalized.captureId && receipt.image.digest === normalized.captureDigest, 'Receipt does not match the capture request');
    const versionId = captureVersionId(normalized.projectId, normalized.viewId, normalized.captureId);
    const boundAt = timestamp(context.now());
    const binding: CaptureBinding = { schema: CAPTURE_BINDING_SCHEMA, workspace: 'hq-local', ...normalized, versionId, boundAt };
    const operation: CaptureAcceptOperation = { schema: CAPTURE_OPERATION_SCHEMA, operationId: normalized.operationId,
      kind: 'accept-capture', requestDigest, result: binding, committedAt: boundAt };
    return { status: 'planned', result: binding, requestDigest, puts: [
      { key: captureBindingKey(captureTupleHex(binding.projectId, binding.viewId, versionId)), expectedRevision: null, value: binding },
      { key: captureOperationKey(binding.operationId), expectedRevision: null, value: operation },
    ] };
  } catch (error) {
    return { status: 'invalid', reason: error instanceof Error ? error.message : 'Invalid capture acceptance input' };
  }
}
