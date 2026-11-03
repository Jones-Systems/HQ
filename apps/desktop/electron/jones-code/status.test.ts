import { expect, it } from 'vitest';
import { JONES_EXISTING_THREAD_QUALIFIED, JONES_NEW_THREAD_QUALIFIED } from './status';
it('requires independent native qualification for existing and new thread delivery', () => { expect(JONES_EXISTING_THREAD_QUALIFIED).toBe(false); expect(JONES_NEW_THREAD_QUALIFIED).toBe(false); });
