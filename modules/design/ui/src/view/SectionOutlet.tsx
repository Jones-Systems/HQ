import { lazy, Suspense, useMemo, useState, type ComponentType, type LazyExoticComponent } from 'react';
import type { ProjectContext, ResolvedAppearance } from '@hq/contracts';
import { ErrorBoundary, InlineNotice, Skeleton } from '@hq/ui';
import type { DesignLocation, DesignSectionProps, SectionStateHandle } from '../../contract.ts';
import type { RegisteredSection } from '../registry.ts';
import { surfaceProps } from '../theme.ts';

export type SectionView = ComponentType<DesignSectionProps>;

// One lazy wrapper per registered section, so section code loads once, on first view.
const lazyViews = new WeakMap<RegisteredSection<SectionView>, LazyExoticComponent<SectionView>>();
function lazyView(section: RegisteredSection<SectionView>): LazyExoticComponent<SectionView> {
  let view = lazyViews.get(section);
  if (!view) {
    view = lazy(async () => ({ default: await section.view() }));
    lazyViews.set(section, view);
  }
  return view;
}

/** Shaped like a section (heading row, then content blocks) and shown only when loading takes a moment. */
function SectionLoading({ title }: { readonly title: string }) {
  return <div className="hqd-section-loading hq-enter-fade" aria-busy="true">
    <p className="hq-sr-only" role="status">Loading {title}…</p>
    <div className="hqd-section-loading-head"><Skeleton width="180px" /><Skeleton width="72px" /></div>
    <div className="hqd-section-loading-body"><Skeleton shape="block" height="160px" /><Skeleton shape="block" height="160px" /><Skeleton shape="block" height="160px" /></div>
  </div>;
}

/** A failure stays inside the section, says what was kept and offers another try; navigation keeps working. */
function SectionFailed({ title, retry }: { readonly title: string; readonly retry: () => void }) {
  return <div className="hqd-section-failed">
    <InlineNotice tone="danger" live="assertive" title={`${title} could not be shown`} actions={[{ label: 'Try again', onAction: retry }]}>
      The rest of Design keeps working, and nothing you saved was changed.
    </InlineNotice>
  </div>;
}

export interface SectionOutletProps {
  readonly section: RegisteredSection<SectionView>;
  readonly context: ProjectContext;
  readonly appearance: ResolvedAppearance;
  readonly state: SectionStateHandle;
  readonly navigate: (location: DesignLocation) => void;
  readonly propose: (projectId: string, label: string, origin: 'section') => void;
  readonly onCommand: (sectionId: string, listener: (commandId: string) => void) => () => void;
}

export function SectionOutlet({ section, context, appearance, state, navigate, propose, onCommand }: SectionOutletProps) {
  const [attempt, setAttempt] = useState(0);
  const View = useMemo(() => lazyView(section), [section, attempt]);
  // A lazy section that failed to load stays failed, so another attempt also loads its code again.
  const retry = () => { lazyViews.delete(section); setAttempt((current) => current + 1); };
  const props: DesignSectionProps = useMemo(() => ({
    context, appearance, sectionId: section.id, state, navigate,
    proposeProjectSwitch: (projectId: string, label: string) => propose(projectId, label, 'section'),
    surface: surfaceProps,
    onCommand: (listener: (commandId: string) => void) => onCommand(section.id, listener),
  }), [context, appearance, section.id, state, navigate, propose, onCommand]);
  return <ErrorBoundary resetKeys={[section.id, context.id, attempt]} fallback={() => <SectionFailed title={section.title} retry={retry} />}>
    <Suspense fallback={<SectionLoading title={section.title} />}>
      <View {...props} />
    </Suspense>
  </ErrorBoundary>;
}
