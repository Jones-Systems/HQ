import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_TASTE_FLAGS, resolveTasteFlags } from '../src/flags.ts';

describe('taste feature flags', () => {
  it('ships rating controls renderable and keeps guidance and legacy reuse off', () => {
    assert.deepEqual(DEFAULT_TASTE_FLAGS, { ratingControls: true, automaticGuidance: false, legacyJournalReuse: false });
    assert.ok(Object.isFrozen(DEFAULT_TASTE_FLAGS));
  });

  it('ignores and reports attempts to enable locked-off capabilities', () => {
    const { flags, ignored } = resolveTasteFlags({ ratingControls: false, automaticGuidance: true, legacyJournalReuse: true, other: 1 });
    assert.deepEqual(flags, { ratingControls: false, automaticGuidance: false, legacyJournalReuse: false });
    assert.deepEqual(ignored, ['automaticGuidance', 'legacyJournalReuse', 'other']);
    assert.deepEqual(resolveTasteFlags(null).flags, DEFAULT_TASTE_FLAGS);
  });
});
