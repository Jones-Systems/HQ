/**
 * Product-safe entry. A finished product may depend on this entry only; it
 * must never reach `src/review/`, `ui/`, or another Design section.
 */
export type {
  ComponentSource, DesignSystem, Easing, MotionFrame, MotionStudy, PropValues, RenderInput, Variant, VariantSet,
} from '../contract.ts';
export { createSourceRevision } from '../model/source.ts';
export { defaultProps, parseVariantSet, resolveRenderInput } from '../model/props.ts';
export { parseDesignSystem, resolveTokens, tokensToCss } from '../model/tokens.ts';
export { ease, easingToCss, parseMotionStudy, sampleStudy } from '../model/motion.ts';
export { webCryptoDigest } from '../model/jcs.ts';
export { buildProductDocument } from './product-document.ts';
