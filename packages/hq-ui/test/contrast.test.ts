import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { composite, contrastRatio, contrastRows, parseColor, resolveRole, type ContrastTokenSource } from '../src/contrast';

const tokens = JSON.parse(readFileSync(new URL('../src/tokens/hq-tokens.json', import.meta.url), 'utf8')) as ContrastTokenSource;
const report = readFileSync(new URL('./fixtures/t2-contrast-report.md', import.meta.url), 'utf8');
const reported = [...report.matchAll(/^\| `([^`]+)` \| `([^`]+)` \| (light|dark) \| ([0-9.]+) \| ([0-9.]+) \| (pass|FAIL) \|$/gm)]
  .map((m) => ({ fg: m[1]!, on: m[2]!, mode: m[3]!, ratio: Number(m[4]), min: Number(m[5]), result: m[6]! }));

describe('contrast helper', () => {
  it('matches WCAG reference values', () => {
    expect(contrastRatio(parseColor('#000000'), parseColor('#FFFFFF'))).toBeCloseTo(21, 10);
    expect(contrastRatio(parseColor('#777777'), parseColor('#FFFFFF'))).toBeCloseTo(4.48, 2);
    expect(composite(parseColor('rgba(0, 0, 0, 0.5)'), parseColor('#FFFFFF')).slice(0, 3)).toEqual([127.5, 127.5, 127.5]);
  });

  it('rejects unsupported colours and translucent roles without an opaque base', () => {
    expect(() => parseColor('hsl(0 0% 0%)')).toThrow(/unsupported/);
    expect(() => parseColor('rgba(0, 0, 0, 1.5)')).toThrow(/out of range/);
    expect(() => resolveRole(tokens, 'surface-hover', 'light')).toThrow(/needs an explicit @base/);
    expect(() => resolveRole(tokens, 'no-such-role', 'light')).toThrow(/unknown colour role/);
  });
});

describe('visual-system contrast pairs, recomputed', () => {
  const rows = contrastRows(tokens);

  it('recomputes all 104 pairs and every one meets its text or control threshold', () => {
    expect(rows).toHaveLength(104);
    expect(rows.filter((row) => !row.pass)).toEqual([]);
    expect(rows.filter((row) => row.mode === 'light')).toHaveLength(52);
  });

  it('holds text to 4.5:1 and focus rings, indicators and control edges to 3:1', () => {
    const nonText = new Set(['focus', 'accent-strong', 'border-control']);
    for (const row of rows) expect(row.min).toBe(nonText.has(row.fg) ? 3 : 4.5);
    expect(rows.filter((row) => row.fg === 'focus')).toHaveLength(10);
  });

  it("agrees with the generated report, pair by pair", () => {
    expect(reported).toHaveLength(104);
    rows.forEach((row, index) => {
      const theirs = reported[index]!;
      expect({ fg: row.fg, on: row.on, mode: row.mode, min: row.min }).toEqual({ fg: theirs.fg, on: theirs.on, mode: theirs.mode, min: theirs.min });
      expect(Math.abs(row.ratio - theirs.ratio)).toBeLessThanOrEqual(0.005 + 1e-9);
      expect(theirs.result).toBe('pass');
    });
    expect(report).toContain('104 pairs checked, 0 below minimum.');
  });
});
