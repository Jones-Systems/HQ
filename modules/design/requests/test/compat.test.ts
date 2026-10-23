import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REVIEW_DECISIONS, type DispatchSlot, type PacketLink } from '../src/contract.ts';
import { CrashingStorageFake, SequentialIdsFake, StepClockFake } from '../src/fakes.ts';
import { canonicalBytes, decodeJson } from '../src/jcs.ts';
import { RequestStore } from '../src/store.ts';
import {
  UnsupportedSchemaError, ValidationError, parseDraft, parseFreezeRecord, parseHandoffStatus, parseReturnedCandidate, parseReviewEvent,
} from '../src/validate.ts';
import {
  GOLDEN_V1_CANDIDATE, GOLDEN_V1_DRAFT, GOLDEN_V1_EVENT, GOLDEN_V1_FREEZE, GOLDEN_V1_REVISION_DRAFT,
} from './golden-v1.ts';

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const encode = (value: string) => new TextEncoder().encode(value);

// Compatibility with the stored bytes of the first requests release (PR #17).

test('every v1 stored document still parses and re-serialises to the same bytes', () => {
  assert.equal(text(canonicalBytes(parseDraft(JSON.parse(GOLDEN_V1_DRAFT)))), GOLDEN_V1_DRAFT);
  assert.equal(text(canonicalBytes(parseDraft(JSON.parse(GOLDEN_V1_REVISION_DRAFT)))), GOLDEN_V1_REVISION_DRAFT);
  assert.equal(text(canonicalBytes(parseFreezeRecord(JSON.parse(GOLDEN_V1_FREEZE)))), GOLDEN_V1_FREEZE);
  assert.equal(text(canonicalBytes(parseReviewEvent(JSON.parse(GOLDEN_V1_EVENT)))), GOLDEN_V1_EVENT);
  assert.equal(text(canonicalBytes(parseReturnedCandidate(JSON.parse(GOLDEN_V1_CANDIDATE)))), GOLDEN_V1_CANDIDATE);
});

test('a v1 candidate keeps its string version and gains no provenance key', () => {
  const parsed = parseReturnedCandidate(JSON.parse(GOLDEN_V1_CANDIDATE));
  assert.equal(parsed.candidateVersionId, 'v-a2');
  assert.equal('provenance' in parsed, false, 'absent provenance stays absent so candidate digests are unchanged');
});

test('a request stored by the v1 release opens unchanged and the open writes nothing', async () => {
  const record = parseFreezeRecord(JSON.parse(GOLDEN_V1_FREEZE));
  const requestId = record.packet.lineage.requestId;
  const storage = new CrashingStorageFake();
  const root = `design/requests/${requestId}`;
  await storage.createDocument('workspace', `${root}/packets/000001`, encode(GOLDEN_V1_FREEZE));
  await storage.createDocument('workspace', `${root}/candidates/cand-1`, encode(GOLDEN_V1_CANDIDATE));
  await storage.appendEvent('workspace', `${root}/review`, encode(GOLDEN_V1_EVENT));
  await storage.createDocument('workspace', `${root}/draft`, encode(GOLDEN_V1_REVISION_DRAFT));
  const store = new RequestStore({ storage, clock: new StepClockFake(), ids: new SequentialIdsFake() });
  const before = storage.calls.length;
  const snapshot = await store.open(requestId);
  assert.equal(snapshot.readOnly, null);
  assert.deepEqual(snapshot.recovered, []);
  assert.equal(snapshot.packets.length, 1);
  assert.deepEqual(snapshot.reviews.map((event) => event.decision), ['revise']);
  assert.equal(snapshot.candidates.length, 1);
  assert.deepEqual(snapshot.sends, []);
  assert.deepEqual(snapshot.handoff, []);
  assert.equal(text(snapshot.draftBytes!), GOLDEN_V1_REVISION_DRAFT);
  const writes = storage.calls.slice(before).filter((call) => ['write', 'create', 'event', 'blob'].includes(call.op));
  assert.deepEqual(writes, [], 'opening a v1 request is read-only');
});

// Enum and shape changes.

test('the review decision enum only grew: the first three keep their values and order', () => {
  assert.deepEqual(REVIEW_DECISIONS.slice(0, 3), ['accept', 'revise', 'defer']);
  assert.deepEqual([...REVIEW_DECISIONS], ['accept', 'revise', 'defer', 'reject']);
});

test('review events: reject needs no revision draft, revise still requires one, others still refuse one', () => {
  const base = JSON.parse(GOLDEN_V1_EVENT) as Record<string, unknown>;
  const withoutDraft = { ...base };
  delete withoutDraft.revisionDraftId;
  assert.equal(parseReviewEvent({ ...withoutDraft, decision: 'reject' }).decision, 'reject');
  assert.throws(() => parseReviewEvent({ ...base, decision: 'reject' }), /required exactly for revise/u);
  assert.throws(() => parseReviewEvent({ ...withoutDraft, decision: 'revise' }), /required exactly for revise/u);
  assert.throws(() => parseReviewEvent({ ...withoutDraft, decision: 'discard' }), /expected one of/u);
});

test('candidate shape: a null version and provenance are new, everything else stays strict', () => {
  const base = JSON.parse(GOLDEN_V1_CANDIDATE) as Record<string, unknown>;
  const versionless = parseReturnedCandidate({ ...base, candidateVersionId: null });
  assert.equal(versionless.candidateVersionId, null);
  assert.equal(parseReturnedCandidate({ ...base, provenance: { origin: 'connector', host: 'h', model: 'm' } }).provenance?.host, 'h');
  assert.equal(parseReturnedCandidate({ ...base, provenance: { origin: 'connector' } }).provenance?.model, undefined);
  assert.throws(() => parseReturnedCandidate({ ...base, provenance: { origin: 'somewhere' } }), /expected one of/u);
  assert.throws(() => parseReturnedCandidate({ ...base, provenance: { origin: 'connector', fallbackHost: 'x' } }), /unexpected key/u);
  assert.throws(() => parseReturnedCandidate({ ...base, extra: 1 }), /unexpected key/u);
  assert.throws(() => parseReturnedCandidate({ ...base, candidateVersionId: 5 }), /expected string/u);
  const missing = { ...base };
  delete missing.candidateVersionId;
  assert.throws(() => parseReturnedCandidate(missing), /candidateVersionId: missing/u, 'the key is nullable, not optional');
});

test('a v1 DispatchSlot implementation that ignores the new binding argument is still assignable', () => {
  const legacy: DispatchSlot = { requestSend(_packet: PacketLink) { /* v1 shape */ } };
  legacy.requestSend({ packetId: 'p' as never, authoringDigest: `sha256:${'0'.repeat(64)}` as never });
});

test('handoff status: closed shape, newer schema reported as unsupported, host and model never defaulted', () => {
  const link = { packetId: 'p', authoringDigest: `sha256:${'a'.repeat(64)}` };
  const status = { schema: 'hq.design.request-handoff-status/v1', packet: link, state: 'queued', observedAt: '2026-01-01T00:00:00.000Z' };
  const parsed = parseHandoffStatus(status);
  assert.equal('pinned' in parsed || 'actual' in parsed, false);
  assert.throws(() => parseHandoffStatus({ ...status, schema: 'hq.design.request-handoff-status/v2' }), UnsupportedSchemaError);
  assert.throws(() => parseHandoffStatus({ ...status, state: 'sent' }), /expected one of/u);
  assert.throws(() => parseHandoffStatus({ ...status, fallback: { host: 'x' } }), ValidationError);
  assert.throws(() => parseHandoffStatus({ ...status, pinned: { host: 'x', note: 'y' } }), /unexpected key/u);
  assert.deepEqual(decodeJson(canonicalBytes(parsed)), status);
});
