/**
 * Sample finished product built from one component. It depends only on the
 * product-safe entry, so it carries no review, annotation or sandbox code.
 * Synthetic content; not owner data.
 */
import {
  buildProductDocument, createSourceRevision, parseDesignSystem, parseVariantSet, resolveRenderInput, resolveTokens,
  webCryptoDigest,
} from '../src/product/index.ts';

const PRICE_TAG = {
  componentId: 'sample-price-tag',
  name: 'Sample Price Tag',
  markup: '<p class="tag"><span class="amount"></span><span class="period"></span></p>',
  styles: '.tag{display:inline-flex;gap:4px;align-items:baseline;font-family:var(--font-base);color:var(--prop-ink)}.amount{font-size:28px;font-weight:700}.period{font-size:13px;opacity:.7}',
  script: "root.querySelector('.amount').textContent = props.amount;\nroot.querySelector('.period').textContent = props.period;",
  props: {
    amount: { kind: 'string', default: '$12', maxLength: 16 },
    period: { kind: 'enum', default: '/month', options: ['/month', '/year'] },
    ink: { kind: 'color', default: '#212529' },
  },
  colorScheme: 'light',
  size: { width: 200, height: 80 },
} as const;

const SYSTEM = {
  id: 'sample-system',
  name: 'Sample product tokens',
  tokens: [{ id: 'font.base', type: 'fontFamily', value: 'system-ui, sans-serif' }],
  groups: [],
} as const;

export async function buildSampleProduct(): Promise<string> {
  const source = await createSourceRevision(PRICE_TAG, 1, webCryptoDigest);
  const variants = parseVariantSet(source, {
    componentId: source.componentId,
    sourceRevision: source.revision,
    variants: [{ id: 'annual', name: 'Annual', props: { amount: '$120', period: '/year' } }],
  });
  const tokens = resolveTokens(parseDesignSystem(SYSTEM)).values;
  return buildProductDocument(source, resolveRenderInput(source, variants, variants.variants[0]?.id ?? null, {}, tokens), 'Pricing');
}
