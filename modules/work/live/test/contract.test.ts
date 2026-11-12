import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeFields, HQ_REFERENCES_FEATURE, type FieldError, type ItemReference } from '../../core';
import { canonicalFields } from '../wire';
import { CONTRACT } from './support';

// Integrity of the pinned public Planner contract copies, and the shared reference vectors run against Work.

/** SHA-256 of the upstream SHA256SUMS file itself, for the PLN-W source compatibility vectors; see contract/PROVENANCE.md. */
const SUMS_SHA256 = 'e06ebfd0278431efa3e6662acecb98dbde0743bf2c3f7a9e2e167c6ebb0e3921';
const UPSTREAM = new URL('../../../../services/planner/contract/', import.meta.url);

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const gitBlob = (bytes: Buffer) => createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest('hex');
const read = (file: string) => readFileSync(new URL(file, CONTRACT));

const sums = read('SHA256SUMS').toString('utf8').trim().split('\n').map((line) => {
  const [hash, file] = line.split(/\s+/u);
  return { hash: hash!, file: file! };
});
const provenance = read('PROVENANCE.md').toString('utf8');
const rows = new Map([...provenance.matchAll(/^\| `([^`]+)` \| `([0-9a-f]{40})` \| (\d+) \|$/gmu)].map((m) => [m[1]!, { blob: m[2]!, bytes: Number(m[3]) }]));

describe('pinned Planner contract copies', () => {
  it('pins SHA256SUMS itself', () => {
    expect(sha256(read('SHA256SUMS'))).toBe(SUMS_SHA256);
    expect(provenance).toContain(SUMS_SHA256);
  });

  it('copies exactly the files SHA256SUMS lists: the exchanges and the reference vectors', () => {
    const copied = [...readdirSync(new URL('exchanges/', CONTRACT)).map((f) => `exchanges/${f}`), 'reference-vectors.json'].sort();
    expect(sums.map((s) => s.file).sort()).toEqual(copied);
    expect([...rows.keys()].sort()).toEqual(['SHA256SUMS', ...copied].sort());
  });

  it.each(sums)('$file matches its pinned SHA-256, Git blob and size', ({ file, hash }) => {
    const bytes = read(file);
    expect(sha256(bytes)).toBe(hash);
    expect(gitBlob(bytes)).toBe(rows.get(file)!.blob);
    expect(bytes.length).toBe(rows.get(file)!.bytes);
  });

  // Explicit either way: absent is reported as unavailable, never as passed; present must match byte for byte.
  const upstream = existsSync(UPSTREAM) ? 'present' : 'unavailable';
  it(`upstream services/planner/contract in this checkout: ${upstream}`, () => {
    expect(upstream === 'present').toBe(existsSync(new URL('SHA256SUMS', UPSTREAM)));
  });
  it.runIf(upstream === 'present')('has not drifted from the upstream service contract', () => {
    for (const file of ['SHA256SUMS', ...sums.map((s) => s.file)]) expect(sha256(readFileSync(new URL(file, UPSTREAM)))).toBe(sha256(read(file)));
  });
});

interface VectorCase { id: string; input: unknown[]; expected?: ItemReference[]; errors?: FieldError[] }
const vectors = JSON.parse(read('reference-vectors.json').toString('utf8')) as { schema: string; feature: string; generated_entry_id: string; cases: VectorCase[] };

describe('shared reference vectors against Work validation', () => {
  it('is the schema and feature Work gates on', () => {
    expect(vectors.schema).toBe('hq.planner.reference-vectors/v1');
    expect(vectors.feature).toBe(HQ_REFERENCES_FEATURE);
  });

  it.each(vectors.cases)('$id', (c) => {
    const result = normalizeFields({ references: c.input }, { creating: false, features: [vectors.feature], newId: () => vectors.generated_entry_id });
    if (c.expected) expect(result).toEqual({ ok: true, value: { references: c.expected } });
    else expect(result).toEqual({ ok: false, errors: c.errors });
  });

  it('preserves remote Wiki provenance in Work wire fields without inferring a source association', () => {
    const c = vectors.cases.find((value) => value.id === 'wiki-return-work')!;
    const result = canonicalFields({ title: 'Source Work item', references: c.input }, [vectors.feature]);
    expect(result).toEqual({ ok: true, value: { title: 'Source Work item', references: c.expected } });
    expect(c.expected![0]).toMatchObject({ target: { domain: 'wiki', projectId: 'remote-project', workspaceId: 'remote-workspace', sourceRevision: 'remote-revision-7', returnDestination: { domain: 'work' } } });
  });

  it('refuses locally, before sending, exactly the vectors whose HQ target parseReference rejects', () => {
    for (const c of vectors.cases) {
      const local = canonicalFields({ title: 'x', references: c.input }, [vectors.feature]);
      const targetRejected = c.errors?.some((e) => e.message.endsWith('has an invalid HQ target.')) ?? false;
      expect([c.id, local.ok]).toEqual([c.id, !targetRejected]);
      if (!local.ok) expect(local.error).toEqual({ kind: 'invalid', errors: c.errors });
    }
  });
});
