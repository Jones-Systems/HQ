import { expect, it } from 'vitest';
import { createFixturePlanner, HQ_REFERENCES_FEATURE, type Item } from '../../core';
import { item } from '../../board/test/fixtures';
import { envelope } from './fixtures';

it('synthetic fixture export/import preserves every envelope byte, including optional fields and Unicode', async () => {
  const target = { ...envelope, title: 'Seeds · café 🌱', workspaceId: 'synthetic-workspace' };
  const original = createFixturePlanner({ features: [HQ_REFERENCES_FEATURE], items: [item('source', 'Source', 'inbox', 1, {
    references: [{ id: 'link', kind: 'hq', label: target.title, target }],
  })] });
  // Fixture transport only: this is not the Planner export API or a new product export format.
  const exported = JSON.stringify(original.control.stored());
  const imported = createFixturePlanner({ features: [HQ_REFERENCES_FEATURE], items: JSON.parse(exported) as Item[] });
  const restored = (await imported.port.snapshot()).items[0]!.references[0]!;
  expect(restored.kind).toBe('hq');
  if (restored.kind !== 'hq') throw new Error('Expected an HQ envelope');
  expect(Buffer.from(JSON.stringify(restored.target))).toEqual(Buffer.from(JSON.stringify(target)));
  expect(JSON.stringify(imported.control.stored())).toBe(exported);
});
