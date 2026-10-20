/** Entry root bundles into the preview preload. Imports nothing outside this folder at runtime. */
export { installPreviewAgent } from './agent.ts';
export type { AgentHost, AgentOptions, PreviewAgent } from './agent.ts';
export { elementPath, textHash } from './dom-path.ts';
export { locateQuote, quoteContext } from './text-quote.ts';
