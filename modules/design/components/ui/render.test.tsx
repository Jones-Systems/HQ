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

describe('PropsPanel', () => {
  it('lists Defaults plus each variant and marks the selected one', async () => {
    const { source, variants } = await button();
    const input = resolveRenderInput(source, variants, 'danger-pill' as VariantId, { label: 'Remove' }, tokens);
    const html = renderToStaticMarkup(<PropsPanel source={source} variants={variants} variantId={'danger-pill' as VariantId}
      overrides={{ label: 'Remove' }} resolved={input.props} onSelectVariant={() => {}} onOverrides={() => {}} />);
    expect(html.match(/type="radio"/gu)).toHaveLength(SYNTHETIC_BUTTON_VARIANTS.length + 1);
    expect(html).toMatch(/<input type="radio"[^>]*checked=""[^>]*\/>Danger pill/u);
    expect(html).toContain('value="Remove"');
    expect(html.match(/data-overridden="true"/gu)).toHaveLength(1);
    expect(html).toContain('never change it');
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
    expect(attributes(html, 'iframe').sandbox).toBe('allow-scripts');
  });
});
