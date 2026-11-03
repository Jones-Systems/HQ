import { expect, it } from 'vitest';
import { adoptionKey, encodedStoreName, isIdentityKey, isOpaqueSegment, operationKey, PROJECTS_REGISTRY_KEY } from './keys.js';

it('reserves exactly registry, operation and adoption identity keys', () => {
  expect(PROJECTS_REGISTRY_KEY).toBe('hq/projects/registry');
  expect(operationKey('create-1')).toBe('hq/projects/operations/create-1');
  expect(adoptionKey('adopt-abc')).toBe('hq/projects/adoptions/adopt-abc');
  for (const key of [PROJECTS_REGISTRY_KEY, operationKey('0'), adoptionKey('a'.repeat(64))]) expect(isIdentityKey(key)).toBe(true);
  for (const key of ['hq/projects/captures/1', 'hq/projects/registry/extra', 'hq/projects/operations/a/b', 'hq/projects/adoptions/A']) {
    expect(isIdentityKey(key)).toBe(false);
  }
});

it.each(['', '-a', 'A', 'a_b', 'a/b', 'a.b', ' a', 'a ', 'é', 'a\n', 'a'.repeat(65)])('refuses non-opaque segment %j', value => {
  expect(isOpaqueSegment(value)).toBe(false);
  expect(() => operationKey(value)).toThrow();
  expect(() => adoptionKey(value)).toThrow();
});

it('uses byte-wise UTF-8 escaping and stays below hashed-name fallback', () => {
  expect(encodedStoreName('a_z-0/Aé~')).toBe('a_z-0~2f~41~c3~a9~7e');
  expect(encodedStoreName(PROJECTS_REGISTRY_KEY)).toBe('hq~2fprojects~2fregistry');
  expect(encodedStoreName('😀')).toBe('~f0~9f~98~80');
  for (const key of [PROJECTS_REGISTRY_KEY, operationKey('a'.repeat(64)), adoptionKey('a'.repeat(64))]) {
    const encoded = encodedStoreName(key);
    expect(encoded.length).toBeLessThan(180);
    expect(encoded.startsWith('=')).toBe(false);
  }
  expect(encodedStoreName('a'.repeat(179))).toHaveLength(179);
  expect(() => encodedStoreName('a'.repeat(180))).toThrow();
  expect(() => encodedStoreName('é'.repeat(30))).toThrow();
  expect(() => encodedStoreName('\ud800')).toThrow();
});

import { captureBindingKey, captureOperationKey, captureReceiptKey, isCaptureKey } from './keys.js';

it('reserves disjoint receipt, binding and capture-operation keys below the encoded-name limit', () => {
  expect(captureReceiptKey('capture-1')).toBe('hq/captures/receipts/capture-1');
  expect(captureOperationKey('accept-1')).toBe('hq/captures/operations/accept-1');
  expect(captureBindingKey('a'.repeat(64))).toBe(`hq/captures/bindings/${'a'.repeat(64)}`);
  const keys = [captureReceiptKey('a'.repeat(64)), captureOperationKey('0'), captureOperationKey('z'.repeat(64)),
    captureBindingKey('0123456789abcdef'.repeat(4))];
  for (const key of keys) {
    expect(isCaptureKey(key)).toBe(true);
    expect(isIdentityKey(key)).toBe(false);
    expect(encodedStoreName(key).length).toBeLessThan(180);
  }
  for (const key of [PROJECTS_REGISTRY_KEY, operationKey('accept-1'), adoptionKey('capture-1')]) expect(isCaptureKey(key)).toBe(false);
  expect(new Set([captureReceiptKey('same'), captureOperationKey('same'), operationKey('same'), adoptionKey('same')]).size).toBe(4);
});

it('refuses capture segment and tuple near misses without extending identity grammar', () => {
  for (const id of ['', '-a', 'A', 'a_b', 'a/b', 'a.b', ' a', 'a ', 'é', 'a\n', 'a'.repeat(65), null, 1]) {
    expect(() => captureReceiptKey(id)).toThrow();
    expect(() => captureOperationKey(id)).toThrow();
    if (typeof id === 'string') {
      expect(isCaptureKey(`hq/captures/receipts/${id}`)).toBe(false);
      expect(isCaptureKey(`hq/captures/operations/${id}`)).toBe(false);
    }
  }
  for (const hex of ['', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64), `sha256:${'a'.repeat(64)}`, `${'a'.repeat(64)}\n`, null]) {
    expect(() => captureBindingKey(hex)).toThrow();
    expect(isCaptureKey(`hq/captures/bindings/${hex}`)).toBe(false);
  }
  for (const key of [null, 1, 'hq/captures/receipt/a', 'hq/captures/receipts/a/extra', 'hq/captures/receipts/a?x',
    'hq/captures/operations/a#x', 'hq/captures/bindings/a', `hq/captures/bindings/${'a'.repeat(64)}/extra`]) {
    expect(isCaptureKey(key)).toBe(false);
    expect(isIdentityKey(key)).toBe(false);
  }
});
