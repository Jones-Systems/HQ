import { Component, createElement } from 'react';
import type { ComponentType, ReactNode } from 'react';
import type { DesignSectionProps } from '../../../ui/contract.ts';

class SectionErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p role="alert">Section unavailable. Stored data was not replaced.</p> : this.props.children; }
}
/** Failure stays local to the mounted section and project. */
export function withSectionErrorBoundary(View: ComponentType<DesignSectionProps>): ComponentType<DesignSectionProps> {
  return (props) => <SectionErrorBoundary key={props.context.id}>{createElement(View, props)}</SectionErrorBoundary>;
}
