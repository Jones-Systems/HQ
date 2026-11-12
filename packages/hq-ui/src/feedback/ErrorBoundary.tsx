import { Component, type ErrorInfo, type ReactNode } from 'react';
import { InlineNotice } from './InlineNotice';

export interface ErrorBoundaryFallbackProps {
  readonly error: unknown;
  /** Clears the error and renders the children again. */
  readonly reset: () => void;
}

export interface ErrorBoundaryProps {
  readonly children?: ReactNode;
  /** Changing any value clears a caught error, for example the route, destination or project id. */
  readonly resetKeys?: readonly unknown[];
  readonly fallback?: (props: ErrorBoundaryFallbackProps) => ReactNode;
  readonly onError?: (error: unknown, info: ErrorInfo) => void;
  /** Title of the default fallback. Default "This view stopped working". */
  readonly title?: string;
}

interface ErrorBoundaryState { readonly error: unknown; readonly failed: boolean; readonly keys: readonly unknown[] | undefined }

function changed(previous: readonly unknown[] | undefined, next: readonly unknown[] | undefined): boolean {
  if (previous === next) return false;
  if (!previous || !next || previous.length !== next.length) return true;
  return previous.some((value, index) => !Object.is(value, next[index]));
}

/**
 * Contains a render failure to the region it wraps. The rest of the app, including navigation, keeps working and
 * the region shows an inline notice with "Try again" instead of a blank window.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null, failed: false, keys: this.props.resetKeys };

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { error, failed: true };
  }

  static getDerivedStateFromProps(props: ErrorBoundaryProps, state: ErrorBoundaryState): Partial<ErrorBoundaryState> | null {
    if (changed(state.keys, props.resetKeys)) return { keys: props.resetKeys, error: null, failed: false };
    return null;
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  private readonly reset = () => this.setState({ error: null, failed: false });

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    if (this.props.fallback) return this.props.fallback({ error: this.state.error, reset: this.reset });
    const message = this.state.error instanceof Error ? this.state.error.message : undefined;
    return (
      <div className="hq-error-boundary">
        <InlineNotice tone="danger" title={this.props.title ?? 'This view stopped working'} actions={[{ label: 'Try again', onAction: this.reset }]}>
          Other areas of HQ still work.{message ? <> <span className="hq-meta">{message}</span></> : null}
        </InlineNotice>
      </div>
    );
  }
}
