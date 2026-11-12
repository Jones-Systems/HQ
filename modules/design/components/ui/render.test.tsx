import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { VariantId } from '../src/contract.ts';
import {
  SYNTHETIC_BUTTON, SYNTHETIC_BUTTON_VARIANTS, SYNTHETIC_CARD, SYNTHETIC_MOTION, SYNTHETIC_SYSTEM,
} from '../src/fixtures.ts';
import { webCryptoDigest } from '../src/model/jcs.ts';
import { parseMotionStudy } from '../src/model/motion.ts';
import { parseVariantSet, resolveRenderInput } from '../src/model/props.ts';
import { createSourceRevision } from '../src/model/source.ts';
import { parseDesignSystem, resolveTokens } from '../src/model/tokens.ts';
import { createFakeClock } from '../src/workspace/fakes.ts';
import { MotionPlayer } from './MotionPlayer.tsx';
import { PropsPanel } from './PropsPanel.tsx';
import { SandboxFrame } from './SandboxFrame.tsx';
import { TokenBoard } from './TokenBoard.tsx';
import { VariantStrip } from './VariantStrip.tsx';

/**
 * Server-rendered markup checks. They prove the produced DOM attributes and
 * structure, not layout, interaction or browser isolation (see harness/).
 */
const system = parseDesignSystem(SYNTHETIC_SYSTEM);
const tokens = resolveTokens(system).values;

async function button() {
  const source = await createSourceRevision(SYNTHETIC_BUTTON, 1, webCryptoDigest);
  const variants = parseVariantSet(source, { componentId: source.componentId, sourceRevision: 1, variants: SYNTHETIC_BUTTON_VARIANTS });
  return { source, variants };
}

function attributes(html: string, tag: string): Record<string, string> {
  const match = new RegExp(`<${tag}\\b([^>]*)>`, 'u').exec(html);
  const found: Record<string, string> = {};
  // HTML attribute names are case-insensitive; React emits some in camelCase.
  for (const attribute of (match?.[1] ?? '').matchAll(/([a-zA-Z-]+)="([^"]*)"/gu)) found[(attribute[1] as string).toLowerCase()] = attribute[2] as string;
  return found;
}

describe('SandboxFrame', () => {
  it('renders an allow-scripts-only srcdoc frame labelled as web evidence', async () => {
    const { source } = await button();
    const html = renderToStaticMarkup(<SandboxFrame source={source} input={resolveRenderInput(source, null, null, {}, tokens)} />);
    const frame = attributes(html, 'iframe');
    expect(frame.sandbox).toBe('allow-scripts');
    expect(frame.referrerpolicy).toBe('no-referrer');
    expect(frame.srcdoc).toContain('Content-Security-Policy');
    expect(frame.src).toBeUndefined();
    expect(html).not.toContain('allow-same-origin');
    expect(html).toContain('not native evidence');
  });
});

describe('VariantStrip', () => {
  it('puts Base first, then each saved variant, with exactly one radio checked', async () => {
    const { source, variants } = await button();
    const html = renderToStaticMarkup(<VariantStrip source={source} variants={variants} variantId={'danger-pill' as VariantId} onSelect={() => {}} />);
    expect(html).toContain('role="radiogroup"');
    expect(html.match(/role="radio"/gu)).toHaveLength(SYNTHETIC_BUTTON_VARIANTS.length + 1);
    expect(html.match(/aria-checked="true"/gu)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*aria-checked="true"[^>]*data-variant="danger-pill"/u);
    expect(html.indexOf('data-variant="~base"')).toBeLessThan(html.indexOf('data-variant="primary"'));
    expect(html).toContain('declared defaults');
    // Prop-diff chips: what each variant sets, in declared prop order.
    expect(html).toContain('label: Delete');
    expect(html).toContain('radius: 24');
    expect(html).toContain('>Neutral small<');
  });

  it('selects Base when no variant is chosen or the chosen one is unknown', async () => {
    const { source, variants } = await button();
    for (const chosen of [null, 'missing' as VariantId]) {
      const html = renderToStaticMarkup(<VariantStrip source={source} variants={variants} variantId={chosen} onSelect={() => {}} />);
      expect(html).toMatch(/<button[^>]*aria-checked="true"[^>]*data-variant="~base"/u);
      expect(html.match(/aria-checked="true"/gu)).toHaveLength(1);
    }
  });

  it('shows only Base when a component has no saved variants', async () => {
    const { source } = await button();
    const html = renderToStaticMarkup(<VariantStrip source={source} variants={null} variantId={null} onSelect={() => {}} />);
    expect(html.match(/role="radio"/gu)).toHaveLength(1);
    expect(html).toContain('No saved variants');
  });
});

describe('PropsPanel', () => {
  it('shows a row per prop with its type, constraint hint and overridden dot, and Reset all only when something is overridden', async () => {
    const { source, variants } = await button();
    const input = resolveRenderInput(source, variants, 'danger-pill' as VariantId, { label: 'Remove' }, tokens);
    const html = renderToStaticMarkup(<PropsPanel source={source} variants={variants} variantId={'danger-pill' as VariantId}
      overrides={{ label: 'Remove' }} resolved={input.props} onOverrides={() => {}} />);
    expect(html).not.toContain('type="radio"');
    expect(html).toContain('value="Remove"');
    expect(html.match(/data-overridden="true"/gu)).toHaveLength(1);
    expect(html.match(/aria-label="Overridden"/gu)).toHaveLength(1);
    expect(html).toContain('0–24, step 1');
    expect(html).toContain('≤ 60 chars');
    expect(html).toContain('primary · neutral · danger');
    expect(html).not.toContain('on or off');
    expect(html).toContain('>Reset all<');
    expect(html).toContain('never change it');
    const clean = renderToStaticMarkup(<PropsPanel source={source} variants={variants} variantId={null}
      overrides={{}} resolved={resolveRenderInput(source, variants, null, {}, tokens).props} onOverrides={() => {}} />);
    expect(clean).not.toContain('Reset all');
    expect(clean).not.toContain('aria-label="Overridden"');
  });

  it('holds the full props table and each variant’s overrides in a Spec disclosure', async () => {
    const { source, variants } = await button();
    const html = renderToStaticMarkup(<PropsPanel source={source} variants={variants} variantId={'danger-pill' as VariantId}
      overrides={{}} resolved={resolveRenderInput(source, variants, 'danger-pill' as VariantId, {}, tokens).props} onOverrides={() => {}} />);
    const spec = /<details class="hqc-spec">([\s\S]*?)<\/details>/u.exec(html)?.[1] ?? '';
    expect(spec).toContain('<summary>Spec</summary>');
    for (const name of Object.keys(SYNTHETIC_BUTTON.props)) expect(spec).toContain(`>${name}</th>`);
    expect(spec).toContain('Variant overrides');
    expect(spec).toContain('label: Delete · tone: danger · radius: 24');
    expect(spec).toMatch(/<tr aria-current="true"><th scope="row">Danger pill/u);
  });
});

describe('TokenBoard', () => {
  it('groups by design system and draws samples from token values, not chrome theme', () => {
    const html = renderToStaticMarkup(<TokenBoard system={system} />);
    for (const name of ['Color', 'Spacing and elevation', 'Typography', 'Ungrouped']) expect(html).toContain(`>${name}</h3>`);
    expect(html).toContain('background-color:#3b5bdb');
    expect(html).toContain('via {color.brand.primary}');
    const light = renderToStaticMarkup(<div className="hqc-root" data-appearance="light"><TokenBoard system={system} /></div>);
    const dark = renderToStaticMarkup(<div className="hqc-root" data-appearance="dark"><TokenBoard system={system} /></div>);
    expect(dark.replace('data-appearance="dark"', '')).toBe(light.replace('data-appearance="light"', ''));
  });
});

describe('MotionPlayer', () => {
  it('renders transport, scrub range and a keyframe control per keyframe at t = 0', async () => {
    const study = parseMotionStudy(SYNTHETIC_MOTION);
    const card = await createSourceRevision(SYNTHETIC_CARD, 1, webCryptoDigest);
    const html = renderToStaticMarkup(<MotionPlayer study={study} clock={createFakeClock(0)}
      target={{ source: card, input: resolveRenderInput(card, null, null, {}, tokens) }} />);
    expect(html).toContain('>Play</button>');
    expect(html).toContain('>Replay</button>');
    const scrubTag = /<input[^>]*class="hqc-scrub"[^>]*>/u.exec(html)?.[0] ?? '';
    expect(attributes(scrubTag, 'input')).toMatchObject({ type: 'range', min: '0', max: '600', value: '0' });
    expect(html).toContain('0 / 600 ms');
    const keyframes = study.tracks.reduce((count, track) => count + track.keyframes.length, 0);
    expect(html.match(/class="hqc-key"/gu)).toHaveLength(keyframes);
    expect(html).not.toContain('<iframe');
    expect(html).toContain('Preview held');
    expect(html).toContain('Proxy · the component itself is held');
    expect(html.match(/data-target=/gu)).toHaveLength(2);
  });
});
