import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectedImportRights } from '../sources/import-rights.ts';
import { withImportRights } from '../capabilities.ts';
import { importSourceId, type ImportSource, RIGHTS_BASES } from '../../../imports/src/contract.ts';

const draft = { basis: '' as const, holder: '', license: '', attribution: '' };
test('rights require explicit basis and holder, with a license for licensed files', () => {
  assert.equal(selectedImportRights(draft), null);
  assert.equal(selectedImportRights({ ...draft, basis: 'owned' }), null);
  assert.equal(selectedImportRights({ ...draft, basis: 'licensed', holder: 'Example creator' }), null);
  assert.equal(selectedImportRights({ ...draft, basis: 'owned', holder: ' padded ' }), null);
  assert.equal(selectedImportRights({ ...draft, basis: 'owned', holder: 'x'.repeat(301) }), null);
  for (const basis of RIGHTS_BASES) {
    const selected = selectedImportRights({ basis, holder: 'Example creator', license: basis === 'licensed' ? 'Example license' : '', attribution: 'Example credit' });
    assert.equal(selected?.basis, basis);
    assert.equal(selected?.attribution, 'Example credit');
  }
});
test('cancelled pick preserves the statement and the next pick applies it without relabelling the source', async () => {
  const rights = selectedImportRights({ ...draft, basis: 'permission', holder: 'Example creator' })!;
  const source: ImportSource = { kind: 'hq.files', version: 1, sourceId: importSourceId('example'), items: [
    { key: 'example.png', title: 'Example', rights: { basis: 'owned', holder: 'Old holder' }, payload: { kind: 'png', bytes: new Uint8Array() } },
  ] };
  let cancelled = true;
  const pick = withImportRights(async () => cancelled ? null : source, rights);
  assert.equal(await pick(), null);
  cancelled = false;
  assert.deepEqual((await pick())?.items[0]?.rights, rights);
  assert.equal(source.items[0]?.rights.holder, 'Old holder');
});
