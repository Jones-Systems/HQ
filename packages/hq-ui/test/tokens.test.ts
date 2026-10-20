import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HQ_ARTWORK_TOKENS, HQ_COLOR_ROLES, HQ_SHADOW_TOKENS, HQ_TOKEN_NAMES } from '../src/tokens';

/**
 * T2 visual system, PR #18, commit f3c1daff9c6ab98d51a1bfb4aafbe83c351c1124, directory docs/design/hq-visual-system.
 * Copies are byte-for-byte; edits happen upstream in T2's JSON source, never here. A changed hash means a hand edit
 * or a new T2 revision, which needs a deliberate rebind of this table.
 */
const T2_COMMIT = 'f3c1daff9c6ab98d51a1bfb4aafbe83c351c1124';
const COPIES = [
  { local: '../src/tokens/hq-tokens.css', upstream: 'tokens/hq-tokens.css', bytes: 9302, gitBlob: 'f916d8bd62a227edf5b9a25df17101a2ea19f07c', sha256: 'bbbb57104ff6d8fe348007aecb1c370fb9ff3b4727d947c89f5e7f0748572d40' },
  { local: '../src/tokens/hq-tokens.json', upstream: 'tokens/hq-tokens.json', bytes: 12684, gitBlob: '792b7d248198c410556aa109a5ac9ce77c7ba980', sha256: '1db2e8add0b3d60072dc1b03a4ecae0b50d6862ca7c144e92343493bf729b2b3' },
  { local: '../src/tokens/t0-bridge.css', upstream: 'tokens/t0-bridge.css', bytes: 661, gitBlob: '6114c05d62034a79c75d3b94bdd624e7105f5f1d', sha256: '617e3d1141f3e2e3e86af3c004cc7068f6dccef3bc639098b7c14658f97a786e' },
  { local: './fixtures/t2-contrast-report.md', upstream: 'tokens/contrast-report.md', bytes: 6686, gitBlob: 'e80b8993d224f3bb7c4afbc03e496bb6ce7a12e9', sha256: '75b08c0eada3ebb60a749471f47978951afe4877b028e845271adb15443605ed' },
] as const;

const read = (path: string) => readFileSync(new URL(path, import.meta.url));
const tokensCss = read('../src/tokens/hq-tokens.css').toString('utf8');
const tokensJson = JSON.parse(read('../src/tokens/hq-tokens.json').toString('utf8')) as {
  color: Record<string, { light: string; dark: string }>;
  invariant: Record<string, { value: string }>;
};

/** Git's object id for a blob, so a copy is tied to T2's immutable tree entry without needing that commit locally. */
function gitBlobId(bytes: Buffer): string {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

describe(`T2 token copies at ${T2_COMMIT.slice(0, 8)}`, () => {
  it.each(COPIES)('$local is byte-identical to T2 $upstream', ({ local, bytes, gitBlob, sha256 }) => {
    const data = read(local);
    expect(data.length).toBe(bytes);
    expect(createHash('sha256').update(data).digest('hex')).toBe(sha256);
    expect(gitBlobId(data)).toBe(gitBlob);
  });
});

describe('token names', () => {
  const declared = [...new Set([...tokensCss.matchAll(/(--hq-[a-z0-9-]+)\s*:/g)].map((m) => m[1]!))];

  it('exports exactly the custom properties the token CSS declares', () => {
    expect([...HQ_TOKEN_NAMES].sort()).toEqual([...declared].sort());
    expect(new Set(HQ_TOKEN_NAMES).size).toBe(HQ_TOKEN_NAMES.length);
  });

  it('has 39 colour roles, each a light-dark() pair equal to the JSON source', () => {
    expect(HQ_COLOR_ROLES).toHaveLength(39);
    expect(HQ_COLOR_ROLES.map((name) => name.slice('--hq-'.length))).toEqual(Object.keys(tokensJson.color));
    for (const role of HQ_COLOR_ROLES) {
      const { light, dark } = tokensJson.color[role.slice('--hq-'.length)]!;
      expect(tokensCss).toContain(`  ${role}: light-dark(${light}, ${dark});`);
    }
  });

  it('keeps the 4 artwork tokens theme-invariant', () => {
    expect(HQ_ARTWORK_TOKENS).toHaveLength(4);
    for (const token of HQ_ARTWORK_TOKENS) {
      const { value } = tokensJson.invariant[token.slice('--hq-'.length)]!;
      expect(tokensCss).toContain(`  ${token}: ${value};`);
      expect(value).not.toMatch(/light-dark/);
    }
  });

  it('switches shadows per scheme and scopes colour by [data-theme]', () => {
    for (const shadow of HQ_SHADOW_TOKENS) expect(tokensCss.split(`${shadow}:`)).toHaveLength(4);
    expect(tokensCss).toContain(':root { color-scheme: light dark; }');
    expect(tokensCss).toContain('[data-theme="light"] { color-scheme: light; }');
    expect(tokensCss).toContain('[data-theme="dark"] { color-scheme: dark; }');
  });

  it('pins preserved wells through --hq-content-scheme with no filter, blend or opacity', () => {
    const well = /\[data-hq-content\] \{([^}]*)\}/.exec(tokensCss)?.[1] ?? '';
    expect(well).toContain('color-scheme: var(--hq-content-scheme, normal);');
    expect(well).toContain('background: var(--hq-artwork-matte);');
    expect(well).toContain('filter: none;');
    expect(well).toContain('mix-blend-mode: normal;');
    expect(well).toContain('opacity: 1;');
  });
});
