import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PropSpec } from '../src/contract.ts';
import { SYNTHETIC_BUTTON, SYNTHETIC_CARD } from '../src/fixtures.ts';
import { coerceProp, validatePropSpecs } from '../src/model/props.ts';
import { constraintHint, propError, propTypeLabel } from '../src/model/prop-hints.ts';

const button = validatePropSpecs(SYNTHETIC_BUTTON.props);
const card = validatePropSpecs(SYNTHETIC_CARD.props);
const spec = (specs: Readonly<Record<string, PropSpec>>, name: string): PropSpec => {
  const found = specs[name];
  assert.ok(found, `fixture declares ${name}`);
  return found;
};

test('constraint hints state the bounds, step, length or options a control enforces', () => {
  assert.equal(constraintHint(spec(button, 'radius')), '0–24, step 1');
  assert.equal(constraintHint(spec(button, 'label')), '≤ 60 chars');
  assert.equal(constraintHint(spec(button, 'tone')), 'primary · neutral · danger');
  assert.equal(constraintHint(spec(button, 'disabled')), '');
  assert.equal(constraintHint(spec(card, 'surface')), 'hex, rgb() or hsl()');
  assert.equal(constraintHint(spec(card, 'body')), '≤ 300 chars');
});

test('number hints cover one-sided, step-only and unbounded numbers; strings without a limit use the stored maximum', () => {
  assert.equal(constraintHint({ kind: 'number', default: 1, min: 1 }), '≥ 1');
  assert.equal(constraintHint({ kind: 'number', default: 1, max: 9, step: 0.5 }), '≤ 9, step 0.5');
  assert.equal(constraintHint({ kind: 'number', default: 1, step: 5 }), 'step 5');
  assert.equal(constraintHint({ kind: 'number', default: 1 }), 'any number');
  assert.equal(constraintHint({ kind: 'string', default: '' }), '≤ 2000 chars');
});

test('type chips use short names', () => {
  assert.deepEqual(['label', 'tone', 'disabled', 'radius'].map((name) => propTypeLabel(spec(button, name))), ['string', 'enum', 'bool', 'number']);
  assert.equal(propTypeLabel(spec(card, 'surface')), 'color');
});

test('a value the contract accepts has no error', () => {
  assert.equal(propError('radius', spec(button, 'radius'), 12), null);
  assert.equal(propError('label', spec(button, 'label'), 'Go'), null);
  assert.equal(propError('tone', spec(button, 'tone'), 'danger'), null);
  assert.equal(propError('disabled', spec(button, 'disabled'), true), null);
  assert.equal(propError('surface', spec(card, 'surface'), '#fff'), null);
});

test('errors say what to change, for each kind of control', () => {
  assert.equal(propError('radius', spec(button, 'radius'), 40), 'Use a number from 0 to 24.');
  assert.equal(propError('radius', spec(button, 'radius'), Number.NaN), 'Enter a number.');
  assert.equal(propError('radius', spec(button, 'radius'), -1), 'Use a number from 0 to 24.');
  assert.equal(propError('label', spec(button, 'label'), 'x'.repeat(72)), 'Too long: 72 of 60 characters.');
  assert.equal(propError('tone', spec(button, 'tone'), 'loud'), 'Choose one of: primary, neutral, danger.');
  assert.equal(propError('surface', spec(card, 'surface'), 'blue'), 'Use a hex, rgb() or hsl() colour, such as #3b5bdb.');
  assert.equal(propError('disabled', spec(button, 'disabled'), 'yes'), 'Choose on or off.');
  assert.equal(propError('n', { kind: 'number', default: 3, min: 3 }, 1), 'Use 3 or more.');
  assert.equal(propError('n', { kind: 'number', default: 3, max: 8 }, 9), 'Use 8 or less.');
});

test('an error exists exactly when the contract would reject the value, and never throws', () => {
  const samples: readonly unknown[] = ['', 'ok', 0, 5, 25, -3, Number.NaN, Number.POSITIVE_INFINITY, true, false, '#12', 'rgb(1, 2, 3)', null, undefined, {}];
  for (const [name, one] of [...Object.entries(button), ...Object.entries(card)]) {
    for (const raw of samples) {
      let rejects = false;
      try { coerceProp(name, one, raw); } catch { rejects = true; }
      const message = propError(name, one, raw);
      assert.equal(message !== null, rejects, `${name} with ${String(raw)}`);
      if (message !== null) assert.ok(message.endsWith('.'), `${name}: a sentence`);
    }
  }
});
