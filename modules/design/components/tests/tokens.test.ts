import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SYNTHETIC_SYSTEM } from '../src/fixtures.ts';
import { groupTokens, parseDesignSystem, resolveTokens, tokensToCss } from '../src/model/tokens.ts';

test('aliases resolve to literal values and emit CSS custom properties', () => {
  const system = parseDesignSystem(SYNTHETIC_SYSTEM);
  const { values, problems } = resolveTokens(system);
  assert.deepEqual(problems, []);
  assert.equal(values['color.action.primary'], '#3b5bdb');
  const css = tokensToCss(values);
  assert.match(css, /--color-action-primary:#3b5bdb;/u);
  assert.match(css, /--space-4:16px;/u);
});

test('design-system grouping buckets tokens by type and keeps ungrouped tokens visible', () => {
  const groups = groupTokens(parseDesignSystem(SYNTHETIC_SYSTEM));
  assert.deepEqual(groups.map((group) => group.name), ['Color', 'Spacing and elevation', 'Typography', 'Ungrouped']);
  const layout = groups[1];
  assert.deepEqual(layout?.byType.map((bucket) => bucket.type), ['dimension', 'shadow']);
  assert.deepEqual(groups[3]?.byType.flatMap((bucket) => bucket.tokens.map((token) => token.id)), ['motion.duration.base']);
  assert.deepEqual(groups[0]?.componentIds, ['synthetic-button', 'synthetic-card']);
});

test('cycles, missing aliases, type mismatches and dependants are reported, not guessed', () => {
  const system = parseDesignSystem({
    id: 'broken', name: 'Broken', groups: [],
    tokens: [
      { id: 'a', type: 'color', value: '{b}' },
      { id: 'b', type: 'color', value: '{a}' },
      { id: 'c', type: 'color', value: '{nope}' },
      { id: 'd', type: 'dimension', value: '{e}' },
      { id: 'e', type: 'color', value: '#fff' },
      { id: 'f', type: 'color', value: '{c}' },
    ],
  });
  const { values, problems } = resolveTokens(system);
  assert.deepEqual(values, { e: '#fff' });
  assert.deepEqual(problems.map((problem) => problem.kind).sort(), ['alias-cycle', 'alias-type', 'alias-unresolved', 'missing-alias']);
});

test('token values that could escape CSS are rejected at parse time', () => {
  for (const value of ['red;}</style><script>', '#fff;--x:1', 'url(https://example.com/x.png)', 'expression(alert(1))']) {
    assert.throws(() => parseDesignSystem({ id: 's', name: 'S', groups: [], tokens: [{ id: 'x', type: 'color', value }] }), value);
  }
  assert.throws(() => parseDesignSystem({ id: 's', name: 'S', groups: [], tokens: [{ id: 'x', type: 'shadow', value: '0 0 1px red; color: x' }] }));
  assert.throws(() => parseDesignSystem({ ...SYNTHETIC_SYSTEM, groups: [{ id: 'g', name: 'G', tokenIds: ['missing'], componentIds: [] }] }), /unknown token/u);
  assert.throws(() => parseDesignSystem({ ...SYNTHETIC_SYSTEM, tokens: [...SYNTHETIC_SYSTEM.tokens, SYNTHETIC_SYSTEM.tokens[0]] }), /Duplicate/u);
});
