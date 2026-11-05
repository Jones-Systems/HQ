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
