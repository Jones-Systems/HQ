import { expect, it } from 'vitest';
import { canonicalJson, sha256 } from './canonical-json.js';
import { manifestRoute } from './paths.js';
import { parseHealth, parseRef, requiredFiles, validateBinding, validateManifest } from './wire.js';
import type { GenerationBinding, GenerationHealth, GenerationManifest } from './types.js';

const binding: GenerationBinding = { origin: 'http://127.0.0.1:43210', publisherId: 'synthetic-publisher', hostId: 'synthetic-host',
  rootId: 'synthetic-root', bindingRevision: 'revision-one', scopeDigest: 'b'.repeat(64), consistencyMode: 'observed-files-v1' };
function vector(mutate?: (value: GenerationManifest) => void) {
  const files = [{ path: 'index.html', size: 3, sha256: 'a'.repeat(64), media_type: 'text/html' },
    { path: 'style.css', size: 4, sha256: 'c'.repeat(64), media_type: 'text/css' }];
  const manifest: GenerationManifest = { schema: 'hq-sync.manifest/v1', publisher_id: binding.publisherId, host_id: binding.hostId,
    root_id: binding.rootId, binding_revision: binding.bindingRevision, scope_digest: binding.scopeDigest, epoch: '9007199254740993',
    sequence: '9007199254740994', predecessor: null, published_at: '2026-01-02T03:04:05Z',
    capture: { method: 'observed-files-v1', observation_id: 'observation-one', started_at: '2026-01-02T03:04:00Z', finished_at: '2026-01-02T03:04:05Z',
      source_generation: null, source_inventory_sha256: null, point_in_time: false, application_completion: 'not-asserted' },
    inventory: { enumeration: 'complete-within-declared-scope', file_count: 2, total_bytes: 7, inventory_sha256: sha256(canonicalJson(files)) },
    files, presentations: [{ id: 'page', kind: 'static', entry_path: 'index.html', preview_path: null,
      dependency_mode: 'declared-transitive', required_paths: ['index.html', 'style.css'] }], retention_policy: 'no-automatic-deletion-v1' };
  mutate?.(manifest);
  const bytes = canonicalJson(manifest);
  const identity = { rootId: binding.rootId, epoch: manifest.epoch, sequence: manifest.sequence, manifestSha256: sha256(bytes) };
  const ref = { schema: 'hq-sync.ref/v1' as const, publisher_id: binding.publisherId, host_id: binding.hostId, root_id: binding.rootId,
    binding_revision: binding.bindingRevision, scope_digest: binding.scopeDigest, epoch: manifest.epoch, sequence: manifest.sequence,
    manifest_sha256: identity.manifestSha256, manifest_path: manifestRoute(identity) };
  return { manifest, bytes, identity, ref };
}
it('validates exact manifest inventory digests, dependencies and string-counter identity', () => {
  const v = vector();
  expect(parseRef(canonicalJson(v.ref), binding)).toEqual(v.ref);
  expect(validateManifest(v.bytes, v.ref, binding)).toEqual(v.manifest);
  expect(requiredFiles(v.manifest)).toEqual(['index.html', 'style.css']);
  expect(() => validateManifest(v.bytes, { ...v.ref, manifest_sha256: 'f'.repeat(64),
    manifest_path: manifestRoute({ ...v.identity, manifestSha256: 'f'.repeat(64) }) }, binding)).toThrow('manifest_digest_mismatch');
});
it('rejects malformed inventories and incomplete or ineligible presentation dependencies', () => {
  const cases: [(value: GenerationManifest) => void, string][] = [
    [v => { v.inventory.inventory_sha256 = '0'.repeat(64); }, 'inventory_mismatch'],
    [v => { v.inventory.file_count++; }, 'inventory_mismatch'],
    [v => { v.presentations[0].required_paths = ['missing.html']; }, 'missing_dependencies'],
    [v => { v.presentations[0].required_paths = ['style.css', 'index.html']; }, 'noncanonical_inventory'],
    [v => { v.presentations[0].preview_path = 'absent.png'; }, 'preview_ineligible'],
    [v => { v.presentations[0].kind = 'file'; }, 'invalid_dependencies'],
    [v => { v.presentations[0].dependency_mode = 'entire-eligible-tree'; v.presentations[0].required_paths = ['index.html']; }, 'missing_dependencies'],
    [v => { v.capture.point_in_time = true; }, 'invalid_capture'],
    [v => { v.published_at = '2026-02-30T00:00:00Z'; }, 'invalid_timestamp'],
    [v => { v.predecessor = { epoch: v.epoch, sequence: v.sequence, manifest_sha256: 'd'.repeat(64) }; }, 'invalid_predecessor'],
    [v => { v.files[1].path = 'INDEX.HTML'; }, 'path_collision'],
    [v => { v.files[0].size = 64 * 1024 * 1024 + 1; }, 'invalid_integer']
  ];
  for (const [mutate, reason] of cases) {
    const v = vector(mutate);
    expect(() => validateManifest(v.bytes, v.ref, binding), reason).toThrow(reason);
  }
});
it('binds producer completion separately from generic observed-file capture', () => {
  const producer = { ...binding, consistencyMode: 'producer-complete-v1' as const };
  const v = vector(value => { value.capture = { ...value.capture, method: 'producer-complete-v1', point_in_time: true,
    application_completion: 'producer-declared-immutable', source_generation: 'release-one', source_inventory_sha256: 'd'.repeat(64) }; });
  expect(validateManifest(v.bytes, v.ref, producer)).toEqual(v.manifest);
  expect(() => validateManifest(v.bytes, v.ref, binding)).toThrow('capture_mode_mismatch');
});
it('accepts the public ISO timestamp forms without normalizing impossible dates', () => {
  for (const published_at of ['20260102T030405+00', '2026-W01-5T03:04:05+00:00', '2026W015T03:04:05Z',
    '2026-01-02 03:04+00:00', '2026-01-02T03:04:05,123456+01:02:03.4']) {
    const v = vector(value => { value.published_at = published_at; });
    expect(validateManifest(v.bytes, v.ref, binding).published_at).toBe(published_at);
  }
  for (const published_at of ['2026-W54-1T00:00:00Z', '2026-01-02T24:00:00Z', '2026-01-02T03:04:05', '2026-01-02T00:00:00+24:00']) {
    const v = vector(value => { value.published_at = published_at; });
    expect(() => validateManifest(v.bytes, v.ref, binding)).toThrow('invalid_timestamp');
  }
});
it('rejects unbound ref routes and binding, epoch and sequence regressions', () => {
  const v = vector();
  expect(() => parseRef(canonicalJson({ ...v.ref, manifest_path: 'http://elsewhere.invalid/manifest.json' }), binding)).toThrow('invalid_manifest_path');
  expect(() => parseRef(canonicalJson({ ...v.ref, publisher_id: 'other-publisher' }), binding)).toThrow('binding_mismatch');
  expect(() => parseRef(canonicalJson(v.ref), binding, { ...v.identity, epoch: '1' })).toThrow('epoch_reconciliation_required');
  expect(() => parseRef(canonicalJson(v.ref), binding, { ...v.identity, sequence: '9007199254740995' })).toThrow('sequence_regression');
  expect(() => parseRef(canonicalJson(v.ref), binding, { ...v.identity, manifestSha256: 'f'.repeat(64) })).toThrow('equal_sequence_digest_mismatch');
});
it('validates independently observed health without treating publication mismatch as freshness', () => {
  const v = vector();
  const health: GenerationHealth = { schema: 'hq-sync.health/v1', publisher_id: binding.publisherId, publisher_instance_id: 'process-one',
    root_id: binding.rootId, binding_revision: binding.bindingRevision, scope_digest: binding.scopeDigest,
    observation_sequence: '9223372036854775807', last_attempt_at: null, last_success_at: null, last_success_age_ms: null,
    source_status: 'changing', reason: 'source_changing', observed_inventory_sha256: null, published: null, pending_change: true, storage_status: 'unknown' };
  expect(parseHealth(canonicalJson(health), binding, v.ref)).toMatchObject({ matchesRef: false, source_status: 'changing', last_success_age_ms: null });
  expect(parseHealth(canonicalJson({ ...health, published: { epoch: v.ref.epoch, sequence: v.ref.sequence, manifest_sha256: v.ref.manifest_sha256 } }), binding, v.ref).matchesRef).toBe(true);
  expect(() => parseHealth(canonicalJson({ ...health, scope_digest: 'e'.repeat(64) }), binding, v.ref)).toThrow('binding_mismatch');
  expect(() => parseHealth(canonicalJson({ ...health, source_status: ['ok'] }), binding, v.ref)).toThrow('invalid_status');
});
it('accepts only an explicitly port-bound IPv4 loopback origin', () => {
  for (const origin of ['https://127.0.0.1:43210', 'http://localhost:43210', 'http://[::1]:43210', 'http://127.0.0.1:43210/',
    'http://127.0.0.1:43210?q=1', 'http://user@127.0.0.1:43210', 'http://127.1:43210', 'http://127.0.0.1:0',
    'http://127.0.0.1:65536', 'http://127.0.0.1:04321', 'http://127.0.0.1:43210#x'])
    expect(() => validateBinding({ ...binding, origin })).toThrow(TypeError);
  expect(validateBinding({ ...binding, origin: 'http://127.0.0.1:80' }).origin).toBe('http://127.0.0.1:80');
});
