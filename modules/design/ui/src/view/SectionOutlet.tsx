import { Component, lazy, Suspense, useMemo, type ComponentType, type LazyExoticComponent, type ReactNode } from 'react';
import type { ProjectContext, ResolvedAppearance } from '@hq/contracts';
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

class SectionBoundary extends Component<{ readonly title: string; readonly children: ReactNode }, { readonly failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  render() {
    return this.state.failed
      ? <div className="hqd-placeholder" role="alert"><h2>{this.props.title} could not be shown</h2><p>The rest of Design keeps working. Reopen the section to try again.</p></div>
      : this.props.children;
  }
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
  const View = lazyView(section);
  const props: DesignSectionProps = useMemo(() => ({
    context, appearance, sectionId: section.id, state, navigate,
    proposeProjectSwitch: (projectId: string, label: string) => propose(projectId, label, 'section'),
    surface: surfaceProps,
    onCommand: (listener: (commandId: string) => void) => onCommand(section.id, listener),
  }), [context, appearance, section.id, state, navigate, propose, onCommand]);
  return <SectionBoundary title={section.title}>
    <Suspense fallback={<div className="hqd-placeholder" aria-busy="true"><p>Loading {section.title}…</p></div>}>
      <View {...props} />
    </Suspense>
  </SectionBoundary>;
}
