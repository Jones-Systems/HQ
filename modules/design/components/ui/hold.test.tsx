import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Static guard for the component-execution hold (`ac.component-static-enablement.001`, `ac.component-scripted-enablement.001`).
 * The composed Components view and every file the workspace renders with must stay free of any way to put component
 * markup, styles or scripts into the renderer. `SandboxFrame.tsx` is the review harness's srcdoc frame; it is not
 * imported by the workspace and this test proves it stays that way.
 */
const UI = ['ComponentsWorkspace.tsx', 'ComponentSurface.tsx', 'HeldBlueprint.tsx', 'MotionPlayer.tsx', 'MotionProxy.tsx', 'PropsPanel.tsx',
  'SegmentedControl.tsx', 'TokenBoard.tsx', 'VariantStrip.tsx', 'useChangeFlash.ts'] as const;

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8');
const strip = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');

const FORBIDDEN: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: 'innerHTML / outerHTML / insertAdjacentHTML', pattern: /\b(?:innerHTML|outerHTML|insertAdjacentHTML)\b/u },
  { name: 'dangerouslySetInnerHTML', pattern: /dangerouslySetInnerHTML/u },
  { name: 'DOMParser', pattern: /\bDOMParser\b/u },
  { name: 'createContextualFragment or range HTML', pattern: /createContextualFragment|\.createRange\(/u },
  { name: 'shadow DOM', pattern: /attachShadow|\bshadowRoot\b/u },
  { name: 'srcdoc frames', pattern: /srcDoc|srcdoc|<iframe/iu },
  { name: 'blob or object URLs', pattern: /createObjectURL|\bblob:/u },
  { name: 'document.write or eval', pattern: /document\.write|\beval\s*\(|new Function\s*\(/u },
  { name: 'a script or style element', pattern: /createElement\(\s*['"](?:script|style|iframe|link)['"]/u },
  { name: 'style or script tags in markup', pattern: /<(?:style|script)\b/u },
];

describe('component execution stays held', () => {
  for (const file of UI) {
    it(`${file} has no way to render component markup, styles or scripts`, () => {
      const source = strip(read(`./${file}`));
      for (const { name, pattern } of FORBIDDEN) expect(pattern.test(source), `${file}: ${name}`).toBe(false);
    });
  }

  it('the composed Components view is held the same way', () => {
    const source = strip(read('../../app/compose/views/ComponentsView.tsx'));
    for (const { name, pattern } of FORBIDDEN) expect(pattern.test(source), `ComponentsView.tsx: ${name}`).toBe(false);
  });

  it('nothing the workspace renders with imports the sandbox frame or builds a sandbox document', () => {
    for (const file of [...UI, '../../app/compose/views/ComponentsView.tsx']) {
      const source = strip(read(file.startsWith('..') ? file : `./${file}`));
      expect(/SandboxFrame|sandbox-document|sandbox-channel|review\//u.test(source), file).toBe(false);
    }
  });

  it('the blueprint and proxy read only metadata: no markup, styles or script fields', () => {
    for (const file of ['HeldBlueprint.tsx', 'MotionProxy.tsx', 'VariantStrip.tsx', 'PropsPanel.tsx', 'TokenBoard.tsx']) {
      const source = strip(read(`./${file}`));
      expect(/\.(?:markup|styles|script)\b/u.test(source), file).toBe(false);
    }
    // The surface checks only whether a script exists, to word the hold; it never reads it into the page.
    const surface = strip(read('./ComponentSurface.tsx'));
    expect(surface.match(/\.(?:markup|styles)\b/gu)).toBeNull();
    expect(surface.match(/source\.script/gu)).toHaveLength(1);
    expect(surface).toContain("source.script.trim() !== ''");
  });
});
