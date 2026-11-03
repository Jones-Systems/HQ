export function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalJSON(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function safeBundlePath(path: string): boolean {
  return path.length > 0 && !path.includes('\\') && !/[\x00-\x1f?#:]/.test(path)
    && path.split('/').every(part => part.length > 0 && !part.startsWith('.'));
}

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.');
  const result = value as Record<string, unknown>;
  if (Object.keys(result).sort().join(',') !== [...keys].sort().join(',')) throw new Error('Unexpected or missing manifest fields.');
  return result;
}
function requireValue(ok: boolean): asserts ok { if (!ok) throw new Error('Invalid preview manifest.'); }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(item => typeof item === 'string') && new Set(value).size === value.length; }
const digest = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

export function validateManifest(value: unknown): void {
  const manifest = object(value, ['schema', 'product', 'target', 'source', 'build', 'fixture', 'environment', 'layout', 'entries', 'capabilities', 'files']);
  requireValue(manifest.schema === 'jones-preview-bundle/v1' && manifest.product === 'hq-desktop' && manifest.target === 'browser');
  const source = object(manifest.source, ['repository', 'revision', 'dirty']);
  requireValue(source.repository === 'Jones-Systems/HQ' && typeof source.revision === 'string' && /^[0-9a-f]{40}$/.test(source.revision) && source.dirty === false);
  const build = object(manifest.build, ['node', 'tool', 'lockfileSha256', 'configSha256']);
  requireValue(typeof build.node === 'string' && /^v\d+\.\d+\.\d+$/.test(build.node) && typeof build.tool === 'string' && /^vite@\d+\.\d+\.\d+$/.test(build.tool) && digest(build.lockfileSha256) && digest(build.configSha256));
  const fixture = object(manifest.fixture, ['id', 'version']);
  requireValue(fixture.id === 'hq-examples' && fixture.version === 1);
  const environment = object(manifest.environment, ['storage', 'polyfills']);
  requireValue(environment.storage === 'memory' && strings(environment.polyfills) && environment.polyfills.length === 1 && environment.polyfills[0] === 'crypto.randomUUID:insecure-context');
  const layout = object(manifest.layout, ['width', 'minWidth']);
  requireValue(layout.width === 1280 && layout.minWidth === 760);
  const capabilities = object(manifest.capabilities, ['available', 'unavailable']);
  requireValue(strings(capabilities.available) && strings(capabilities.unavailable));
  const unavailable = capabilities.unavailable;
  requireValue(!capabilities.available.some(item => unavailable.includes(item)));
  requireValue(Array.isArray(manifest.entries) && manifest.entries.length > 0);
  const ids = new Set(); const entries = new Set();
  for (const value of manifest.entries) {
    const entry = object(value, ['id', 'title', 'path']);
    requireValue(typeof entry.id === 'string' && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(entry.id) && !ids.has(entry.id));
    requireValue(typeof entry.title === 'string' && entry.title.length > 0 && typeof entry.path === 'string' && /^[a-z0-9][a-z0-9-]*\.html$/.test(entry.path) && !entries.has(entry.path));
    ids.add(entry.id); entries.add(entry.path);
  }
  requireValue(ids.has('default') && Array.isArray(manifest.files));
  let previous = '';
  const files = new Set();
  for (const value of manifest.files) {
    const file = object(value, ['path', 'sha256', 'bytes']);
    requireValue(typeof file.path === 'string' && safeBundlePath(file.path) && file.path !== 'preview-bundle.json' && file.path > previous && digest(file.sha256) && Number.isSafeInteger(file.bytes) && (file.bytes as number) >= 0);
    previous = file.path; files.add(file.path);
  }
  requireValue([...entries].every(path => files.has(path)));
}
