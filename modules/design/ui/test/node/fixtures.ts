import type { DesignNavId } from '../../contract.ts';
import type { ChromeView, SectionSummary } from '../../src/focus.ts';

/** Synthetic sections spread over every navigation area. */
export const SYNTHETIC_SECTIONS: readonly SectionSummary[] = [
  { id: 'projects', title: 'Projects', nav: 'projects' },
  { id: 'discovery', title: 'Sources', nav: 'projects' },
  { id: 'references', title: 'References', nav: 'resources' },
  { id: 'components', title: 'Components', nav: 'resources' },
  { id: 'canvas', title: 'Canvas', nav: 'review' },
  { id: 'compare', title: 'Compare', nav: 'review' },
  { id: 'requests', title: 'Requests', nav: 'requests' },
  { id: 'connector', title: 'Runs', nav: 'runs' },
];

export function byNav(sections: readonly SectionSummary[]): Record<DesignNavId, readonly SectionSummary[]> {
  return {
    projects: sections.filter((s) => s.nav === 'projects'), resources: sections.filter((s) => s.nav === 'resources'),
    review: sections.filter((s) => s.nav === 'review'), requests: sections.filter((s) => s.nav === 'requests'),
    runs: sections.filter((s) => s.nav === 'runs'),
  };
}

export function chromeView(overrides: Partial<ChromeView> = {}): ChromeView {
  return {
    location: { nav: 'projects', section: null }, sectionsByNav: byNav(SYNTHETIC_SECTIONS),
    visible: { sidebar: true, inspector: true }, lastSection: {}, ...overrides,
  };
}

/** A section entry as a Vite eager glob would return it. */
export function entry(id: string, nav: DesignNavId, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { designModule: { schema: 'hq.design.section/v1', id, title: id[0]!.toUpperCase() + id.slice(1), nav, view: async () => null, ...extra } };
}
