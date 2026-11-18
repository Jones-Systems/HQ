import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ComponentId, ComponentSource } from '../src/contract.ts';
import { SYNTHETIC_BUTTON, SYNTHETIC_CARD, SYNTHETIC_SYSTEM } from '../src/fixtures.ts';
import { blueprintCaption, dimsLabel, frameSize, primaryText, tokensUsedBy, WIDTH_PRESETS } from '../src/model/blueprint.ts';
import { webCryptoDigest } from '../src/model/jcs.ts';
import { defaultProps } from '../src/model/props.ts';
import { createSourceRevision } from '../src/model/source.ts';
import { parseDesignSystem, resolveTokens } from '../src/model/tokens.ts';

const system = parseDesignSystem(SYNTHETIC_SYSTEM);
const values = resolveTokens(system).values;

/** A source whose component code fields throw when read, proving the blueprint helpers never touch them. */
function codeGuarded(source: ComponentSource): ComponentSource {
  return new Proxy(source, {
    get(target, key, receiver) {
      if (key === 'markup' || key === 'styles' || key === 'script') throw new Error(`blueprint read component ${String(key)}`);
      return Reflect.get(target, key, receiver) as unknown;
    },
  });
}

test('the blueprint text is the label prop, else title, else the first string prop', async () => {
  const buttonSource = await createSourceRevision(SYNTHETIC_BUTTON, 1, webCryptoDigest);
  const cardSource = await createSourceRevision(SYNTHETIC_CARD, 1, webCryptoDigest);
  assert.deepEqual(primaryText(buttonSource, { ...defaultProps(buttonSource), label: 'Remove' }), { name: 'label', text: 'Remove' });
  assert.deepEqual(primaryText(cardSource, defaultProps(cardSource)), { name: 'title', text: 'Weekly summary' });
  const noText = { ...buttonSource, props: { size: { kind: 'number', default: 1 } } } as ComponentSource;
  assert.equal(primaryText(noText, { size: 1 }), null);
  const firstString = { ...buttonSource, props: { note: { kind: 'string', default: 'n' }, tone: { kind: 'enum', default: 'a', options: ['a'] } } } as ComponentSource;
  assert.deepEqual(primaryText(firstString, { note: 'hi', tone: 'a' }), { name: 'note', text: 'hi' });
});

test('the caption joins the variant name and the quoted text, shortening long text', () => {
  assert.equal(blueprintCaption('Primary', 'Continue'), 'Primary · “Continue”');
  assert.equal(blueprintCaption('Base', null), 'Base');
  assert.equal(blueprintCaption('Base', '   '), 'Base');
  assert.equal(blueprintCaption('Base', 'a\n b'), 'Base · “a b”');
  const long = blueprintCaption('Base', 'x'.repeat(60));
  assert.equal(long, `Base · “${'x'.repeat(31)}…”`);
});

test('width presets keep the declared height and either keep or replace the declared width', () => {
  const declared = { width: 240, height: 120 };
  assert.deepEqual(WIDTH_PRESETS, ['fit', 320, 480]);
  assert.deepEqual(frameSize(declared, 'fit'), declared);
  assert.deepEqual(frameSize(declared, 320), { width: 320, height: 120 });
  assert.deepEqual(frameSize(declared, 480), { width: 480, height: 120 });
  assert.equal(dimsLabel(frameSize(declared, 'fit')), '240 × 120');
});

test('tokens used by a component come from the groups that list it, once each, with resolved values', () => {
  const button = tokensUsedBy([system], 'synthetic-button' as ComponentId, values);
  assert.deepEqual(button.map((token) => token.id), [
    'color.brand.primary', 'color.brand.danger', 'color.neutral.700', 'color.action.primary', 'font.family.base', 'font.weight.bold',
  ]);
  assert.equal(button.find((token) => token.id === 'color.action.primary')?.value, '#3b5bdb');
  assert.deepEqual([...new Set(button.map((token) => token.group))], ['Color', 'Typography']);
  const card = tokensUsedBy([system], 'synthetic-card' as ComponentId, values);
  assert.deepEqual(card.map((token) => token.type), ['color', 'color', 'color', 'color', 'dimension', 'dimension', 'shadow']);
  assert.deepEqual(tokensUsedBy([system], 'unknown' as ComponentId, values), []);
  assert.deepEqual(tokensUsedBy([], 'synthetic-card' as ComponentId, values), []);
});

test('a token that did not resolve keeps a null value instead of a guess', () => {
  const unresolved = tokensUsedBy([system], 'synthetic-card' as ComponentId, {});
  assert.ok(unresolved.every((token) => token.value === null));
});

test('a token listed by two groups, or two systems, is reported once', () => {
  const twice = parseDesignSystem({
    ...SYNTHETIC_SYSTEM,
    groups: [
      ...SYNTHETIC_SYSTEM.groups,
      { id: 'again', name: 'Again', tokenIds: ['color.brand.primary'], componentIds: ['synthetic-card'] },
    ],
  });
  const card = tokensUsedBy([twice, twice], 'synthetic-card' as ComponentId, values);
  assert.equal(card.filter((token) => token.id === 'color.brand.primary').length, 1);
});

test('blueprint metadata helpers never read the component markup, styles or script', async () => {
  const source = codeGuarded(await createSourceRevision(SYNTHETIC_BUTTON, 1, webCryptoDigest));
  assert.equal(primaryText(source, defaultProps(source))?.text, 'Continue');
  assert.deepEqual(frameSize(source.size, 480), { width: 480, height: 120 });
  assert.equal(tokensUsedBy([system], source.componentId, values).length, 6);
});
