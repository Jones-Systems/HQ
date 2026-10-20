import { expect, it } from 'vitest';
import { PREVIEW_HOST_ENABLED, PREVIEW_PICK_QUALIFIED } from './status';
it('keeps production preview and pick qualification disabled', () => { expect(PREVIEW_HOST_ENABLED).toBe(false); expect(PREVIEW_PICK_QUALIFIED).toBe(false); });
