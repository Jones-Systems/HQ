// Synthetic, validator-valid Wiki data: invented names and text only, no corpus bytes.
// Shared by the tests and the Vite harness; never imported by production code.

import {
  MAX_RESULTS,
  pageKeyId,
  type AliasResolution,
  type BlockNode,
  type IndexStatus,
  type InlineNode,
  type LinkTarget,
  type OutLink,
  type Page,
  type PageContent,
  type PageField,
  type PageKey,
  type SearchHit,
  type SourceDescriptor,
  type Topic,
  type WikiNamespace,
  type WikiResult,
  type WikiService,
} from '../../contract/src/index.ts';

// ---- builders ----

export const text = (value: string): InlineNode => ({ type: 'text', value });
export const code = (value: string): InlineNode => ({ type: 'inlineCode', value });
export const em = (strong: boolean, ...children: InlineNode[]): InlineNode => ({ type: 'emphasis', strong, children });
export const link = (target: LinkTarget, ...children: InlineNode[]): InlineNode => ({ type: 'link', target, children });
export const para = (...children: InlineNode[]): BlockNode => ({ type: 'paragraph', children });
export const heading = (depth: 1 | 2 | 3 | 4 | 5 | 6, value: string): BlockNode => ({ type: 'heading', depth, children: [text(value)] });
export const key = (namespace: WikiNamespace, path: string): PageKey => ({ namespace, path });
const cell = (value: string) => ({ type: 'tableCell', children: [text(value)] }) as const;

export const COMMIT_BL = '1f3a5c7e9b2d4f60718293a4b5c6d7e8f9012345';
export const COMMIT_BL_OLD = '0a1b2c3d4e5f60718293a4b5c6d7e8f901234567';
export const COMMIT_APPDEV = '9e8d7c6b5a4938271605f4e3d2c1b0a998877665';

export const SOURCES: Readonly<Record<WikiNamespace, SourceDescriptor>> = {
  bl: {
    schema: 'hq.wiki.source/v1',
    namespace: 'bl',
    ref: 'main',
    commit: COMMIT_BL,
    commitTime: '2026-09-30T08:15:00Z',
    indexedAt: '2026-10-01T06:00:12.250Z',
    freshness: { graph: { state: 'current', indexedCommit: COMMIT_BL }, content: { state: 'unknown', checkedAt: null } },
  },
  appdev: {
    schema: 'hq.wiki.source/v1',
    namespace: 'appdev',
    ref: 'main',
    commit: COMMIT_APPDEV,
    commitTime: '2026-10-12T17:40:00Z',
    indexedAt: '2026-10-05T06:00:00Z',
    freshness: { graph: { state: 'stale', indexedCommit: COMMIT_BL_OLD }, content: { state: 'behind', checkedAt: '2026-10-13T09:00:00Z' } },
  },
};

// ---- pages ----

interface Spec {
  readonly key: PageKey;
  readonly title: string;
  readonly fields?: readonly PageField[];
  readonly content: PageContent;
  readonly outLinks?: readonly OutLink[];
}

const OTHER_PAGE = key('bl', 'lessons/cash-flow.md');
const ONBOARDING_A = key('bl', 'lessons/onboarding.md');
const ONBOARDING_B = key('bl', 'guides/onboarding.md');
const PRICING_BL = key('bl', 'lessons/pricing.md');
const PRICING_APPDEV = key('appdev', 'research/pricing.md');
export const AMBIGUOUS_ONBOARDING: LinkTarget = { kind: 'ambiguous', candidates: [ONBOARDING_A, ONBOARDING_B] };
const MISSING_CHURN: LinkTarget = { kind: 'missing', label: 'Churn playbook' };
const EXTERNAL_STUDY: LinkTarget = { kind: 'external', url: 'https://example.com/pricing-study?utm=wiki#results' };

const SPECS: Spec[] = [
  {
    key: PRICING_BL,
    title: 'Pricing',
    fields: [
      { name: 'title', value: 'Pricing' },
      { name: 'type', value: 'lesson' },
      { name: 'tags', value: ['money', 'strategy'] },
      { name: 'reviewed', value: true },
      { name: 'confidence', value: 0.8 },
    ],
    outLinks: [
      { text: 'cash flow', target: { kind: 'page', key: OTHER_PAGE } },
      { text: 'Onboarding', target: AMBIGUOUS_ONBOARDING },
      { text: 'Churn playbook', target: MISSING_CHURN },
      { text: 'a pricing study', target: EXTERNAL_STUDY },
    ],
    content: {
      state: 'parsed',
      ast: {
        type: 'document',
        children: [
          heading(1, 'Pricing'),
          para(
            text('Synthetic fixture for the Wiki view. Pricing connects to '),
            link({ kind: 'page', key: OTHER_PAGE }, text('cash flow')),
            text(' and to '),
            link(AMBIGUOUS_ONBOARDING, text('Onboarding')),
            text('; see also '),
            link(MISSING_CHURN, text('Churn playbook')),
            text(' and '),
            link(EXTERNAL_STUDY, text('a pricing study')),
            text('.'),
          ),
          heading(2, 'Models'),
          {
            type: 'list',
            ordered: false,
            items: [
              { type: 'listItem', children: [para(text('Flat fee'))] },
              { type: 'listItem', children: [para(em(true, text('Usage-based')), text(' with a '), code('floor'))] },
              { type: 'listItem', children: [para(text('Tiered, per '), em(false, text('seat')))] },
            ],
          },
          { type: 'quote', children: [para(text('Price is what you pay; value is what you get.'))] },
          { type: 'fence', lang: 'ts', text: 'const price = base * seats;\n' },
          {
            type: 'table',
            align: ['left', 'right'],
            header: { type: 'tableRow', cells: [cell('Plan'), cell('Seats')] },
            rows: [
              { type: 'tableRow', cells: [cell('Starter'), cell('3')] },
              { type: 'tableRow', cells: [cell('Team'), cell('10')] },
            ],
          },
          heading(2, 'Inert text'),
          para(
            text("<script>window.__wikiPwned = true</script> "),
            text('[click me](javascript:window.__wikiPwned=true) '),
            text('<a href="https://evil.example/steal">visit</a> '),
            text('<img src=x onerror="window.__wikiPwned=true">'),
          ),
        ],
      },
    },
  },
  {
    key: PRICING_APPDEV,
    title: 'Pricing',
    fields: [
      { name: 'title', value: 'Pricing' },
      { name: 'type', value: 'research' },
    ],
    outLinks: [{ text: 'navigation', target: { kind: 'page', key: key('appdev', 'notes/navigation.md') } }],
    content: {
      state: 'parsed',
      ast: {
        type: 'document',
        children: [
          heading(1, 'Pricing'),
          para(text('A same-title page in a different repository. It stays distinct from the BusinessLessons page. See '), link({ kind: 'page', key: key('appdev', 'notes/navigation.md') }, text('navigation')), text('.')),
        ],
      },
    },
  },
  {
    key: OTHER_PAGE,
    title: 'Cash flow',
    fields: [{ name: 'type', value: 'lesson' }],
    outLinks: [{ text: 'pricing', target: { kind: 'page', key: PRICING_BL } }],
    content: {
      state: 'parsed',
      ast: { type: 'document', children: [heading(1, 'Cash flow'), para(text('Timing matters more than totals. Back to '), link({ kind: 'page', key: PRICING_BL }, text('pricing')), text('.'))] },
    },
  },
  {
    key: ONBOARDING_A,
    title: 'Onboarding',
    fields: [{ name: 'type', value: 'lesson' }],
    content: { state: 'parsed', ast: { type: 'document', children: [heading(1, 'Onboarding'), para(text('The lesson: first run decides retention.'))] } },
  },
  {
    key: ONBOARDING_B,
    title: 'Onboarding',
    fields: [{ name: 'type', value: 'guide' }],
    outLinks: [{ text: 'pricing', target: { kind: 'page', key: PRICING_BL } }],
    content: {
      state: 'parsed',
      ast: { type: 'document', children: [heading(1, 'Onboarding'), para(text('The guide: a checklist for the first run. Pairs with '), link({ kind: 'page', key: PRICING_BL }, text('pricing')), text('.'))] },
    },
  },
  {
    key: key('bl', 'lessons/raw-frontmatter.md'),
    title: 'Raw frontmatter sample',
    content: {
      state: 'raw',
      reason: 'frontmatter-unsupported',
      text: '---\ntitle: [unclosed list\nowner: {nested: map}\n---\n# Body stays readable\n\nPlain <b>markup</b> and <script>window.__wikiPwned = true</script> are shown verbatim.\n',
    },
  },
  {
    key: key('bl', 'lessons/markdown-limits.md'),
    title: 'Markdown limits sample',
    content: { state: 'raw', reason: 'markdown-unsupported', text: '# Deeply nested\n\n> > > > > quote that exceeded the supported structure\n' },
  },
  {
    key: key('bl', 'lessons/binary-notes.md'),
    title: 'Binary notes sample',
    content: { state: 'raw', reason: 'not-text', text: 'Header ��� trailing bytes were not valid UTF-8 �\n' },
  },
  {
    key: key('appdev', 'notes/navigation.md'),
    title: 'Navigation',
    fields: [{ name: 'type', value: 'note' }],
    outLinks: [{ text: 'pricing', target: { kind: 'page', key: PRICING_APPDEV } }],
    content: { state: 'parsed', ast: { type: 'document', children: [heading(1, 'Navigation'), para(text('Destinations are logical, never URLs. See '), link({ kind: 'page', key: PRICING_APPDEV }, text('pricing')), text('.'))] } },
  },
  {
    key: key('appdev', 'notes/offline-sync.md'),
    title: 'Offline sync',
    fields: [{ name: 'type', value: 'note' }],
    content: { state: 'parsed', ast: { type: 'document', children: [heading(1, 'Offline sync'), para(text('Queue writes locally; reconcile on reconnect.'))] } },
  },
  {
    key: key('appdev', 'research/onboarding-flows.md'),
    title: 'Onboarding flows',
    content: { state: 'parsed', ast: { type: 'document', children: [heading(1, 'Onboarding flows'), para(text('A research note on first-run flows.'))] } },
  },
];

const ARCHIVE_COUNT = 60;
for (let i = 1; i <= ARCHIVE_COUNT; i++) {
  const n = String(i).padStart(2, '0');
  SPECS.push({
    key: key('bl', `archive/entry-${n}.md`),
    title: `Archive entry ${n}`,
    content: { state: 'parsed', ast: { type: 'document', children: [heading(1, `Archive entry ${n}`), para(text(`Synthetic archive record number ${i}.`))] } },
  });
}

function plain(nodes: readonly InlineNode[]): string {
  return nodes.map((node) => (node.type === 'text' || node.type === 'inlineCode' ? node.value : node.type === 'emphasis' || node.type === 'link' ? plain(node.children) : '')).join('');
}
function blockText(blocks: readonly BlockNode[]): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case 'heading':
        case 'paragraph':
          return plain(block.children);
        case 'list':
          return block.items.map((item) => blockText(item.children)).join(' ');
        case 'quote':
          return blockText(block.children);
        case 'fence':
          return block.text;
        default:
          return [block.header, ...block.rows].flatMap((row) => row.cells.map((c) => plain(c.children))).join(' ');
      }
    })
    .join(' ');
}

function searchable(spec: Spec): string {
  return spec.content.state === 'parsed' ? blockText(spec.content.ast.children) : spec.content.text;
}

export const PAGES: readonly Page[] = SPECS.map((spec) => ({
  key: spec.key,
  title: spec.title,
  commit: SOURCES[spec.key.namespace].commit,
  byteLength: 200 + searchable(spec).length,
  fields: spec.fields ?? [],
  outLinks: spec.outLinks ?? [],
  content: spec.content,
}));

const SEARCH_TEXT = new Map(SPECS.map((spec) => [pageKeyId(spec.key), searchable(spec)]));

// ---- derived views ----

export const ALIASES: Readonly<Record<WikiNamespace, Readonly<Record<string, AliasResolution>>>> = {
  bl: {
    pricing: { status: 'resolved', target: PRICING_BL },
    'cash flow': { status: 'resolved', target: OTHER_PAGE },
    onboarding: { status: 'ambiguous', candidates: [ONBOARDING_A, ONBOARDING_B] },
  },
  appdev: {
    pricing: { status: 'resolved', target: PRICING_APPDEV },
  },
};

export const TOPICS: Readonly<Record<WikiNamespace, readonly Topic[]>> = {
  bl: [
    { id: 'finance', label: 'Finance', parentId: null, pageCount: 2, pages: [PRICING_BL, OTHER_PAGE] },
    { id: 'finance-pricing', label: 'Pricing models', parentId: 'finance', pageCount: 1, pages: [PRICING_BL] },
    { id: 'customers', label: 'Customers', parentId: null, pageCount: 2, pages: [ONBOARDING_A, ONBOARDING_B] },
    { id: 'samples', label: 'Parser samples', parentId: null, pageCount: 3, pages: [key('bl', 'lessons/raw-frontmatter.md'), key('bl', 'lessons/markdown-limits.md'), key('bl', 'lessons/binary-notes.md')] },
    {
      id: 'archive',
      label: 'Archive',
      parentId: null,
      pageCount: ARCHIVE_COUNT,
      pages: SPECS.filter((spec) => spec.key.path.startsWith('archive/')).slice(0, MAX_RESULTS).map((spec) => spec.key),
    },
  ],
  appdev: [
    { id: 'app-shell', label: 'App shell', parentId: null, pageCount: 2, pages: [key('appdev', 'notes/navigation.md'), PRICING_APPDEV] },
    { id: 'data', label: 'Data', parentId: null, pageCount: 1, pages: [key('appdev', 'notes/offline-sync.md')] },
    { id: 'data-sync', label: 'Sync', parentId: 'data', pageCount: 1, pages: [key('appdev', 'notes/offline-sync.md')] },
  ],
};

export function indexStatus(): IndexStatus {
  const count = (namespace: WikiNamespace): number => PAGES.filter((page) => page.key.namespace === namespace).length;
  return {
    namespaces: [
      { namespace: 'bl', state: 'ready', pageCount: count('bl'), source: SOURCES.bl },
      { namespace: 'appdev', state: 'stale', pageCount: count('appdev'), source: SOURCES.appdev },
    ],
  };
}

function tokens(query: string): string[] {
  return query.toLowerCase().split(/\s+/u).filter((token) => token.length > 0);
}

function snippetFor(body: string, words: readonly string[]): string {
  const lower = body.toLowerCase();
  const positions = words.map((word) => lower.indexOf(word)).filter((index) => index >= 0);
  const start = Math.max(0, (positions.length > 0 ? Math.min(...positions) : 0) - 30);
  return body.slice(start, start + 160).trim();
}

/** An instant, in-memory implementation of exactly the seven read-only methods. */
export function createSyntheticService(): WikiService {
  const ok = <T>(value: T): Promise<WikiResult<T>> => Promise.resolve({ ok: true, value });
  const notFound = <T>(message: string): Promise<WikiResult<T>> => Promise.resolve({ ok: false, error: { code: 'not-found', reason: 'not-found', message } });
  const find = (target: PageKey): Page | undefined => PAGES.find((page) => pageKeyId(page.key) === pageKeyId(target));

  return {
    listSources: () => ok([SOURCES.bl, SOURCES.appdev]),
    indexStatus: () => ok(indexStatus()),
    search: ({ query, namespaces, limit }) => {
      const words = tokens(query);
      const scope = namespaces ?? (['bl', 'appdev'] as const);
      const scored: SearchHit[] = [];
      for (const page of PAGES) {
        if (!scope.includes(page.key.namespace)) continue;
        const body = SEARCH_TEXT.get(pageKeyId(page.key)) ?? '';
        const title = page.title.toLowerCase();
        let score = 0;
        for (const word of words) {
          if (title.includes(word)) score += 2;
          if (body.toLowerCase().includes(word)) score += 1;
        }
        if (score > 0) scored.push({ key: page.key, title: page.title, score, snippet: snippetFor(body, words).slice(0, 512) });
      }
      scored.sort((a, b) => b.score - a.score || (pageKeyId(a.key) < pageKeyId(b.key) ? -1 : 1));
      const hits = scored.slice(0, limit ?? MAX_RESULTS);
      return ok({ query, hits, totalHits: scored.length, truncated: scored.length > hits.length });
    },
    getPage: ({ key: target }) => {
      const page = find(target);
      return page === undefined ? notFound('No such page in the pinned source.') : ok(page);
    },
    resolveAlias: ({ namespace, alias }) => ok(ALIASES[namespace][alias.trim().toLowerCase().replace(/\s+/gu, ' ')] ?? { status: 'missing' }),
    getBacklinks: ({ key: target, limit }) => {
      const sources = PAGES.filter((page) => page.outLinks.some((outLink) => outLink.target.kind === 'page' && pageKeyId(outLink.target.key) === pageKeyId(target)));
      const entries = sources.slice(0, limit ?? MAX_RESULTS).map((page) => ({ source: page.key, title: page.title }));
      return ok({ target, entries, total: sources.length, truncated: sources.length > entries.length });
    },
    listTopics: ({ namespace }) => ok({ namespace, topics: TOPICS[namespace] }),
  };
}
