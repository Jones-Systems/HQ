import { readFileSync } from 'node:fs';
import { expect, expectTypeOf, it } from 'vitest';
import type { ServiceResponse, WorkServiceParams } from '@hq/contracts/services';
import type { WorkExportPort } from '../port';

it('matches the landed explicit client signature using canonical service types, without an apps import', () => {
  type CanonicalSignature = (format: WorkServiceParams['export']['format']) => Promise<ServiceResponse<{ saved: boolean }>>;
  expectTypeOf<WorkExportPort['export']>().toEqualTypeOf<CanonicalSignature>();
  expectTypeOf<keyof WorkExportPort>().toEqualTypeOf<'export'>();
  // Read-only signature guard binds the type-level comparison to the actual landed client declaration.
  const client = readFileSync(new URL('../../../../apps/desktop/src/services/work-export.ts', import.meta.url), 'utf8');
  expect(client).toContain("async export(format: 'json' | 'markdown'): Promise<ServiceResponse<{ saved: boolean }>>");
});
