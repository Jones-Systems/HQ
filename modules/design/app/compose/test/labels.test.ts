import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PROVENANCE_KINDS } from '../../../canvas/src/contract.ts';
import {
  CACHED_TAG, FAKE_TAG, SYNTHETIC_TAG, WORKSPACE_TAG, isLabelledAsNotReal, labelledProviderTitle, provenanceForClaim, tagForVersionOrigin,
} from '../labels.ts';

describe('evidence labels', () => {
  it('maps lane evidence claims to canvas provenance and never to native evidence', () => {
    assert.equal(provenanceForClaim('web-sandbox'), 'component-sandbox');
    assert.equal(provenanceForClaim('web-approximation'), 'web-approximation');
    for (const claim of ['native-evidence', 'native', 'ios-simulator', '', 'constructor', '__proto__']) {
      assert.notEqual(provenanceForClaim(claim), 'native-evidence', claim);
      assert.equal(provenanceForClaim(claim), 'unspecified', claim);
    }
    for (const claim of ['web-sandbox', 'web-approximation', 'static-capture', 'live-preview', 'reference']) {
      assert.ok(PROVENANCE_KINDS.includes(provenanceForClaim(claim)));
    }
  });

  it('labels every non-workspace source as not real, and only workspace records read as real', () => {
    for (const tag of [FAKE_TAG, SYNTHETIC_TAG, CACHED_TAG]) {
      assert.equal(isLabelledAsNotReal(tag), true, tag.status);
      assert.match(labelledProviderTitle('Flows', tag), new RegExp(`\\(${tag.status}\\)$`, 'u'));
    }
    assert.equal(isLabelledAsNotReal(WORKSPACE_TAG), false);
    assert.equal(labelledProviderTitle('Flows', WORKSPACE_TAG), 'Flows');
  });

  it('does not stack the same label twice', () => {
    assert.equal(labelledProviderTitle(labelledProviderTitle('Flows', FAKE_TAG), FAKE_TAG), 'Flows (fake)');
  });

  it('treats synthetic-fixture versions as synthetic and other origins as workspace records', () => {
    assert.equal(tagForVersionOrigin('synthetic-fixture'), SYNTHETIC_TAG);
    for (const origin of ['owner-created', 'imported', 'returned-candidate']) assert.equal(tagForVersionOrigin(origin), WORKSPACE_TAG);
  });
});
