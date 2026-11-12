import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const css = readFileSync(new URL('./settings.css', import.meta.url), 'utf8');
const rule = (selector: string) => css.split('}').map(block => block.trim()).find(block => block.startsWith(`${selector} {`)) ?? '';

it('stacks a field label above its control (X16)', () => {
  expect(rule('.settings-field')).toMatch(/display:\s*grid/);
  expect(rule('.settings-field > label')).toMatch(/font:\s*var\(--hq-type-label\)/);
});

it('uses design tokens for colour and motion, with no literal colours or transition timings', () => {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  expect(stripped).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  expect(stripped).not.toMatch(/transition:[^;]*\b\d+ms\b/);
  expect(stripped).not.toMatch(/cubic-bezier\(/);
});

it('never sets an inline style attribute that the CSP would block', () => {
  for (const file of ['../ServiceSettings.tsx', './parts.tsx', './Overview.tsx', './ServicesPanel.tsx', './WikiPanel.tsx', './ProjectSources.tsx', '../appearance/ThemeTiles.tsx']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    expect(source, file).not.toMatch(/setAttribute\(\s*['"]style['"]|\.cssText\s*=|style=["'`]/);
  }
});

it('slows rather than removes the spinner under reduced motion', () => {
  expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{[^}]*settings-icon\.is-spinning[^}]*animation-duration/);
  expect(css).toMatch(/data-hq-motion="reduce"\]\s*\.settings-icon\.is-spinning\s*\{[^}]*animation-duration/);
});
