import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyEdit, newDraft } from '../src/draft.ts';
import { canonicalize, digestOf } from '../src/jcs.ts';
import { authoringBody, buildPacket, verifyPacket } from '../src/packet.ts';

// Golden freeze vector. The expected canonical text and digest were computed by an
// independent reference (Python json.dumps with sorted keys, compact separators,
// non-ASCII preserved, then SHA-256), not by this module, and agree with it.
const CANONICAL = "{\"annotations\":[],\"attachments\":[],\"clarifications\":[],\"destination\":{\"destinationId\":\"dest-g\",\"kind\":\"existing-thread\",\"label\":\"Fixture thread\"},\"evidence\":[{\"digest\":\"sha256:fixture\",\"evidenceId\":\"ev-g\",\"kind\":\"note\",\"label\":\"Zeta then alpha\"}],\"frozenAt\":\"2026-03-04T05:07:08.000Z\",\"intent\":\"Line one\\n\\tTabbed \\\"quote\\\" \\\\ backslash \\r CR   LS   NBSP 😀 end\",\"lineage\":{\"draft\":{\"draftId\":\"draft-golden\",\"revision\":3},\"origin\":\"initial\",\"parent\":null,\"requestId\":\"req-golden\",\"review\":null,\"rootPacketId\":\"pkt-golden\",\"sequence\":1},\"packetId\":\"pkt-golden\",\"projectId\":\"proj-g\",\"schema\":\"hq.design.decision-packet/v1\",\"sources\":[{\"projectId\":\"proj-g\",\"sourceRevision\":\"rev-0042\",\"versionId\":\"ver-g1\",\"viewId\":\"view-g\"}],\"supersedes\":null,\"title\":\"Golden “title” — ünï\"}";
const DIGEST = "sha256:67b1ba8c805588c6a6bf38b4d11ef398d4b632e4fcaf726e7de914624857402b";

const T0 = '2026-03-04T05:06:07.000Z';

function vectorDraft() {
  let draft = newDraft({ requestId: 'req-golden' as never, draftId: 'draft-golden' as never, now: T0, title: 'Golden “title” — ünï', sources: [
    { projectId: 'proj-g' as never, viewId: 'view-g' as never, versionId: 'ver-g1' as never, sourceRevision: 'rev-0042' },
  ] });
  draft = applyEdit(draft, { type: 'set-intent', intent: 'Line one\n\tTabbed \"quote\" \\ backslash \r CR \u2028 LS \u00a0 NBSP 😀 end' }, T0);
  draft = applyEdit(draft, { type: 'add-evidence', evidence: { evidenceId: 'ev-g' as never, kind: 'note', label: 'Zeta then alpha', digest: 'sha256:fixture' } }, T0);
  draft = applyEdit(draft, { type: 'set-destination', destination: { kind: 'existing-thread', destinationId: 'dest-g', label: 'Fixture thread' } }, T0);
  return draft;
}

test('freeze body canonicalization matches the independent golden vector byte for byte', async () => {
  const packet = await buildPacket(vectorDraft(), 'pkt-golden' as never, '2026-03-04T05:07:08.000Z', null);
  assert.equal(canonicalize(authoringBody(packet)), CANONICAL);
  assert.equal(packet.authoringDigest, DIGEST);
  assert.equal(await digestOf(authoringBody(packet)), DIGEST);
});

test('the golden packet verifies, and any one-character change is a digest mismatch', async () => {
  const packet = await buildPacket(vectorDraft(), 'pkt-golden' as never, '2026-03-04T05:07:08.000Z', null);
  await verifyPacket(JSON.parse(JSON.stringify(packet)));
  const tampered = JSON.parse(JSON.stringify(packet).replace('Golden', 'Goldfn'));
  await assert.rejects(verifyPacket(tampered), /digest mismatch/u);
});

test('key order, whitespace and undefined fields cannot change the digest', async () => {
  const packet = await buildPacket(vectorDraft(), 'pkt-golden' as never, '2026-03-04T05:07:08.000Z', null);
  const body = authoringBody(packet);
  const shuffled = Object.fromEntries(Object.entries(body).reverse());
  assert.equal(await digestOf({ ...shuffled, ignored: undefined }), DIGEST);
  assert.equal(await digestOf(JSON.parse(JSON.stringify(body, null, 4))), DIGEST);
});
