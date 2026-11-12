import { expect, it } from 'vitest';
import { describe } from '../services/observed-status';
import { NOT_CHECKED } from '../services/data-source-status';
import { chipFor, detailFor } from './status';

it.each(['reachable', 'unreachable'] as const)('keeps the shared %s observation and timestamp in Settings', state => {
  const status = describe('work', { config: NOT_CHECKED, observed: { state, at: 1_800_000_000_000 } });
  const chip = chipFor(status);
  expect(chip).toMatchObject({ label: status.label, tone: status.indicator, detail: status.detail });
  expect(detailFor('work', status)).toBe(status.text);
});
