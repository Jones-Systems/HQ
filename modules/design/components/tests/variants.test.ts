import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { VariantId } from '../src/contract.ts';
import { SYNTHETIC_BUTTON, SYNTHETIC_SYSTEM } from '../src/fixtures.ts';
import { webCryptoDigest } from '../src/model/jcs.ts';
import { defaultProps, parseVariantSet, resolveRenderInput } from '../src/model/props.ts';
import { verifySourceRevision } from '../src/model/source.ts';
import { parseDesignSystem, resolveTokens } from '../src/model/tokens.ts';
import { buildSandboxDocument } from '../src/review/sandbox-document.ts';
import { IntegrityError, keys } from '../src/workspace/library.ts';
import { seededWorkspace } from './helpers.ts';

const tokens = resolveTokens(parseDesignSystem(SYNTHETIC_SYSTEM)).values;

test('changing variants and overrides never changes the stored source', async () => {
  const { storage, library, button, buttonVariants } = await seededWorkspace();
  const sourceKey = keys.source(button.componentId, button.revision);
  const variantKey = keys.variants(button.componentId, button.revision);
  const sourceBytes = storage.raw(sourceKey);
  const variantBytes = storage.raw(variantKey);
  const writesBefore = storage.writes.length;

  const rendered = new Set<string>();
  for (const variant of [null, ...buttonVariants.variants.map((item) => item.id)]) {
    const input = resolveRenderInput(button, buttonVariants, variant, { label: 'Override' }, tokens);
    rendered.add(JSON.stringify(input.props));
    buildSandboxDocument(button, input, { nonce: 'test-nonce-0001' });
    await library.saveSession(button, buttonVariants, variant, { label: 'Override' });
  }

  // The "primary" variant restates the defaults, so it renders the same props as no variant.
  assert.equal(rendered.size, buttonVariants.variants.length, 'variants render their own props');
  const newWrites = storage.writes.slice(writesBefore);
  assert.ok(newWrites.length > 0);
  assert.ok(newWrites.every((write) => write.key === keys.session(button.componentId)), 'only the session key is written');
  assert.equal(storage.raw(sourceKey), sourceBytes, 'stored source bytes are identical');
  assert.equal(storage.raw(variantKey), variantBytes, 'stored variant set is identical');
  const reread = await library.getSource(button.componentId, button.revision);
  assert.equal(reread.digest, button.digest);
  assert.ok(await verifySourceRevision(reread, webCryptoDigest));
});

test('resolved render input is derived and frozen; the source object cannot be mutated', async () => {
  const { button, buttonVariants } = await seededWorkspace();
  const input = resolveRenderInput(button, buttonVariants, 'danger-pill' as VariantId, {}, tokens);
  assert.deepEqual(input.props, { ...defaultProps(button), tone: 'danger', radius: 24, label: 'Delete' });
  assert.equal(input.sourceDigest, button.digest);
  assert.ok(Object.isFrozen(input) && Object.isFrozen(input.props));
  assert.throws(() => { (button as { markup: string }).markup = 'changed'; }, TypeError);
  assert.throws(() => { (button.props as Record<string, unknown>).label = null; }, TypeError);
});

test('editing source appends a revision and leaves the earlier one byte-identical', async () => {
  const { storage, library, button } = await seededWorkspace();
  const firstBytes = storage.raw(keys.source(button.componentId, 1));
  const writesBefore = storage.writes.length;
  const same = await library.saveSource(SYNTHETIC_BUTTON);
  assert.equal(same.revision, 1, 'unchanged content is not a new revision');
  assert.equal(storage.writes.length, writesBefore, 'unchanged content writes nothing');

  const edited = await library.saveSource({ ...SYNTHETIC_BUTTON, styles: `${SYNTHETIC_BUTTON.styles}.btn{letter-spacing:.02em}` });
  assert.equal(edited.revision, 2);
  assert.notEqual(edited.digest, button.digest);
  assert.equal(storage.raw(keys.source(button.componentId, 1)), firstBytes);
  assert.deepEqual(await library.revisions(button.componentId), [1, 2]);
});

test('a variant set is never rebound implicitly to another revision', async () => {
  const { library, button, buttonVariants } = await seededWorkspace();
  const edited = await library.saveSource({ ...SYNTHETIC_BUTTON, name: 'Synthetic Button v2' });
  assert.throws(() => parseVariantSet(edited, buttonVariants), /not rebound implicitly/u);
  assert.throws(() => resolveRenderInput(edited, buttonVariants, 'primary' as VariantId, {}, tokens), /no matching variant set/u);
  assert.equal(await library.getVariants(edited), null);
  assert.ok(await library.getVariants(button));
});

test('invalid prop values are rejected rather than clamped or converted', async () => {
  const { button, buttonVariants } = await seededWorkspace();
  for (const overrides of [{ radius: 99 }, { radius: '6' }, { tone: 'loud' }, { disabled: 'yes' }, { undeclared: 1 }, { label: 'x'.repeat(61) }]) {
    assert.throws(() => resolveRenderInput(button, buttonVariants, null, overrides, tokens), TypeError, JSON.stringify(overrides));
  }
  assert.throws(() => parseVariantSet(button, { ...buttonVariants, variants: [{ id: 'bad', name: 'Bad', props: { radius: -1 } }] }), TypeError);
});

test('a tampered stored source is rejected on read', async () => {
  const { storage, library, button } = await seededWorkspace();
  const key = keys.source(button.componentId, button.revision);
  const tampered = JSON.parse(storage.raw(key) as string);
  tampered.script = 'document.body.textContent = "changed";';
  storage.tamper(key, JSON.stringify(tampered));
  await assert.rejects(library.getSource(button.componentId, button.revision), IntegrityError);
});

test('session restores the exact selection and drops a stale one', async () => {
  const { library, button, buttonVariants } = await seededWorkspace();
  await library.saveSession(button, buttonVariants, 'neutral-small' as VariantId, { radius: 12 });
  const session = await library.getSession(button.componentId);
  assert.deepEqual(session, { componentId: button.componentId, revision: 1, variantId: 'neutral-small', overrides: { radius: 12 } });
  await assert.rejects(library.saveSession(button, buttonVariants, 'missing' as VariantId, {}), RangeError);
});
