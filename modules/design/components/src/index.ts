/**
 * Framework-free entry for root composition. React views live in `ui/` so
 * consumers of the models and provider do not load React.
 */
export type * from './contract.ts';
export { brandId } from './model/ids.ts';
export { canonicalize, isDigest, jcsDigest, webCryptoDigest } from './model/jcs.ts';
export { createSourceRevision, parseSourceInput, verifySourceRevision } from './model/source.ts';
export { coerceProp, defaultProps, parseVariantSet, propsToCss, resolveRenderInput, validatePropSpecs } from './model/props.ts';
export { groupTokens, parseDesignSystem, resolveTokens, tokenCssName, tokensToCss } from './model/tokens.ts';
export type { ResolvedTokens, TokenGroupView, TokenProblem } from './model/tokens.ts';
export {
  EASING_PRESETS, ease, easingCurve, easingToCss, frameToStyles, parseEasing, parseMotionStudy, progressAt,
  sampleStudy, totalDuration, withSegmentEasing,
} from './model/motion.ts';
export { INITIAL_PLAYER, currentTime, frameAt, pause, play, replay, scrub, setLoop, tick } from './model/player.ts';
export type { PlayerState } from './model/player.ts';
export { ComponentLibrary, IntegrityError } from './workspace/library.ts';
export type { ComponentSession, ProjectMembership } from './workspace/library.ts';
export { createFakeClock, createMemoryStorage, performanceClock } from './workspace/fakes.ts';
export type { FakeClock, MemoryStorage } from './workspace/fakes.ts';
export {
  SANDBOX_ALLOW, SANDBOX_CHANNEL, SANDBOX_CSP, SANDBOX_TOKENS, buildSandboxDocument, createSandboxNonce,
  sandboxFrameAttributes, validateSandboxTokens,
} from './review/sandbox-document.ts';
export { motionFrameMessage, parseSandboxMessage } from './review/sandbox-channel.ts';
export type { SandboxEvent } from './review/sandbox-channel.ts';
export { COMPONENTS_PROVIDER_ID, componentItemKey, createComponentsCanvasProvider, motionItemKey, parseItemKey } from './review/canvas-provider.ts';
export type { ComponentsCanvasProvider, ComponentsProviderOptions } from './review/canvas-provider.ts';
export { buildProductDocument } from './product/product-document.ts';
