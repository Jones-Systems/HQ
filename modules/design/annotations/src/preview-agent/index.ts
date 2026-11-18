/** IIFE library entry for isolated-world injection; all imports stay in this folder. */
export { installPreviewAgent } from './agent.ts';
export type { AgentHost, AgentOptions, PreviewAgent } from './agent.ts';
export { createPreviewAgentQueue, installPreviewAgentHost, PREVIEW_QUEUE_CAPACITY } from './host.ts';
export type { PreviewAgentHost, PreviewAgentQueue } from './host.ts';
export type { AgentEvent, AgentMode, AgentFrame, ExactTarget, ExactResolveRequest, ExactResolveResult, ExactResolution } from './types.ts';
export { elementPath, textHash } from './dom-path.ts';
export { locateQuote, quoteContext } from './text-quote.ts';
