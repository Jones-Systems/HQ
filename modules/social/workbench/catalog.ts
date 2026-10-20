import { TOOL_CATEGORIES, type Tool, type ToolCategory, type ToolId } from '../core';

/**
 * What each delivered workbench does and its stated limit, as the Social workspace service documents them
 * (docs/evidence/hq-social-work/social-workbench/README.md, "Interface research"). Names, categories and
 * descriptions come from the service's own catalog in the workspace snapshot, never from here.
 */
export interface ToolGuide {
  readonly id: ToolId;
  /** The delivered browser recipe: what this workbench covers today. */
  readonly recipe: string;
  /** The delivered limit text, shown on every surface for the tool. */
  readonly limit: string;
  /** Simple fields, or typed file import for the structured tools (RR-2). */
  readonly input: 'fields' | 'import';
  /** Delivered qualifications shown beside the inputs. */
  readonly notices: readonly string[];
}

export const TOOL_GUIDES: { readonly [T in ToolId]: ToolGuide } = {
  'tiktok-intelligence': {
    id: 'tiktok-intelligence', input: 'import', notices: [],
    recipe: 'Import supplied snapshot batches and analyze a niche', limit: 'No TikTok access or live discovery',
  },
  'x-intelligence': {
    id: 'x-intelligence', input: 'fields', notices: [],
    recipe: 'Topic-tag supplied JSON Feed items and export evidence', limit: 'No feed fetching',
  },
  'x-studio': {
    id: 'x-studio', input: 'fields',
    recipe: 'Compose notes into post/thread/article and save a draft',
    limit: 'Deterministic local composer; example voice, human claim review needed',
    notices: ['Uses a deterministic local composer and a built-in example voice. This is a starting draft, not a personalized AI writer or a verified factual review.'],
  },
  'seo-studio': {
    id: 'seo-studio', input: 'import', notices: [],
    recipe: 'Validate supplied configuration and article packets', limit: 'No editorial approval or site publishing',
  },
  'search-visibility': {
    id: 'search-visibility', input: 'import', notices: [],
    recipe: 'Analyze supplied panels, entities, inventory and answer observations', limit: 'No search-engine queries',
  },
  'social-publisher': {
    id: 'social-publisher', input: 'fields', notices: [],
    recipe: 'Native five-channel text validation',
    limit: 'Text-only; unsupported formats and missing account evidence remain visible',
  },
  'reddit-opportunities': {
    id: 'reddit-opportunities', input: 'import',
    recipe: 'Analyze an imported corpus', limit: 'Built-in packbench-observed example-product profile',
    notices: ['Scores against the built-in packbench-observed example product profile. Custom product profiles exist only in the native tool.'],
  },
  'creator-relationships': {
    id: 'creator-relationships', input: 'import', notices: [],
    recipe: 'Import supplied creators and explain fit', limit: 'No messages, outreach or account actions',
  },
};

/** RR-7: stated on every workbench and run surface. */
export const DELIVERED_LIMITS = 'No account connection, posting, live collection or scheduling. Workbenches analyze only the material you supply, offline.';

export const EXAMPLE_NOTICE = 'Examples are fictional or synthetic sample inputs, not evidence about your brand.';

export interface CatalogGroup {
  readonly category: ToolCategory;
  readonly tools: readonly Tool[];
}

/** The service's tools grouped by their delivered categories, in category order, keeping service order inside each. */
export function groupTools(tools: readonly Tool[]): CatalogGroup[] {
  return TOOL_CATEGORIES
    .map((category) => ({ category, tools: tools.filter((tool) => tool.category === category) }))
    .filter((group) => group.tools.length > 0);
}
