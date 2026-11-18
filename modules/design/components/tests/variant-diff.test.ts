import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ComponentSource, VariantId } from '../src/contract.ts';
import { SYNTHETIC_BUTTON, SYNTHETIC_BUTTON_VARIANTS } from '../src/fixtures.ts';
import { webCryptoDigest } from '../src/model/jcs.ts';
import { defaultProps, parseVariantSet, resolveRenderInput } from '../src/model/props.ts';
import { createSourceRevision } from '../src/model/source.ts';
import { changedProps, formatPropValue, limitChips, variantDiff } from '../src/model/variant-diff.ts';

async function button(): Promise<ComponentSource> {
  return createSourceRevision(SYNTHETIC_BUTTON, 1, webCryptoDigest);
}

test('a variant diff lists what the variant sets, in declared prop order, as name: value chips', async () => {
  const source = await button();
  const danger = SYNTHETIC_BUTTON_VARIANTS.find((variant) => variant.id === 'danger-pill');
  assert.ok(danger);
  // The variant lists `tone, radius, label`; the component declares `label, tone, size, disabled, radius`.
  const chips = variantDiff(source, danger.props);
  assert.deepEqual(chips.map((chip) => chip.text), ['label: Delete', 'tone: danger', 'radius: 24']);
  assert.ok(chips.every((chip) => chip.changed));
});

test('a variant that restates a default is marked unchanged and a variant with no props has no chips', async () => {
  const source = await button();
  const primary = variantDiff(source, { tone: 'primary' });
  assert.deepEqual(primary.map((chip) => [chip.text, chip.changed]), [['tone: primary', false]]);
  assert.deepEqual(variantDiff(source, {}), []);
  const mixed = variantDiff(source, { tone: 'neutral', size: 'md' });
  assert.deepEqual(mixed.map((chip) => [chip.name, chip.changed]), [['tone', true], ['size', false]]);
});

test('props the component does not declare never become chips', async () => {
  const source = await button();
  assert.deepEqual(variantDiff(source, { ghost: 'x', radius: 3 }).map((chip) => chip.name), ['radius']);
});

test('boolean, number and long text values format compactly', () => {
  assert.equal(formatPropValue(true), 'true');
  assert.equal(formatPropValue(0), '0');
  assert.equal(formatPropValue(12.5), '12.5');
  assert.equal(formatPropValue('Cancel'), 'Cancel');
  assert.equal(formatPropValue('  two\n lines  '), 'two lines');
  const long = formatPropValue('This label is much longer than a chip should carry');
  assert.equal(long.length, 24);
  assert.ok(long.endsWith('…'));
});

test('limitChips shows the first few and counts the rest, clamping odd limits', async () => {
  const source = await button();
  const chips = variantDiff(source, { label: 'A', tone: 'danger', size: 'lg', radius: 3 });
  const split = limitChips(chips, 3);
  assert.deepEqual(split.shown.map((chip) => chip.name), ['label', 'tone', 'size']);
  assert.deepEqual(split.hidden.map((chip) => chip.name), ['radius']);
  assert.deepEqual(limitChips(chips, 99).hidden, []);
  assert.deepEqual(limitChips(chips, -1).shown, []);
  assert.deepEqual(limitChips(chips, 1.9).shown.length, 1);
});

test('changedProps names the values that differ between two resolved prop sets', async () => {
  const source = await button();
  const set = parseVariantSet(source, { componentId: source.componentId, sourceRevision: 1, variants: SYNTHETIC_BUTTON_VARIANTS });
  const base = resolveRenderInput(source, set, null, {}, {}).props;
  const danger = resolveRenderInput(source, set, 'danger-pill' as VariantId, {}, {}).props;
  assert.deepEqual(changedProps(base, danger), ['label', 'tone', 'radius']);
  assert.deepEqual(changedProps(base, base), []);
  assert.deepEqual(changedProps(defaultProps(source), { ...defaultProps(source), disabled: true }), ['disabled']);
  // A name present on one side only counts as changed.
  assert.deepEqual(changedProps({ a: 1 }, { b: 2 }), ['b', 'a']);
  assert.deepEqual(changedProps({ n: Number.NaN }, { n: Number.NaN }), []);
});
