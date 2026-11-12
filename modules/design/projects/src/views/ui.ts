/**
 * Shared motion and feedback primitives, injected rather than imported.
 *
 * The section's views run in plain Node for server-render tests and in the browser harness, where `@hq/ui`
 * (stylesheets, `.tsx`) cannot load. Root passes the real primitives through `ProjectsSection`'s `ui` prop;
 * without them the views fall back to the same markup and class names with no animation and no toasts.
 * The structural types below name only what the views use, and the compose layer's type check proves the
 * real `@hq/ui` exports satisfy them.
 */
import { createContext, createElement as h, useContext, type ComponentType, type ReactNode } from 'react';

export type PresenceMotionName = 'fade' | 'rise' | 'drop' | 'scale' | 'slide-end' | 'slide-start' | 'collapse';

export interface PresenceLikeProps {
  readonly show: boolean;
  readonly motion?: PresenceMotionName;
  readonly initial?: boolean;
  readonly as?: 'div' | 'section' | 'li' | 'span' | 'aside';
  readonly id?: string;
  readonly className?: string;
  readonly children?: ReactNode;
}

export interface SkeletonLikeProps {
  readonly shape?: 'text' | 'block' | 'circle';
  readonly lines?: number;
  readonly width?: string;
  readonly height?: string;
  readonly className?: string;
}

export interface FieldErrorLikeProps {
  readonly id: string;
  readonly children?: ReactNode;
  readonly announce?: boolean;
}

export interface NoticeLikeProps {
  readonly tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'unknown';
  readonly title: string;
  readonly children?: ReactNode;
  readonly actions?: readonly { readonly label: string; readonly onAction: () => void; readonly busy?: boolean; readonly busyLabel?: string }[];
  readonly variant?: 'banner' | 'bar';
  readonly live?: 'polite' | 'assertive' | 'off';
  readonly className?: string;
}

export interface ToastLikeOptions { readonly description?: string; readonly meta?: string }

export interface ToastLike {
  success(title: string, options?: ToastLikeOptions): unknown;
  error(title: string, options?: ToastLikeOptions): unknown;
  info(title: string, options?: ToastLikeOptions): unknown;
}

export interface ProjectsUi {
  readonly Presence: ComponentType<PresenceLikeProps>;
  readonly Skeleton: ComponentType<SkeletonLikeProps>;
  readonly FieldError: ComponentType<FieldErrorLikeProps>;
  readonly InlineNotice: ComponentType<NoticeLikeProps>;
  fieldErrorProps(id: string, error: unknown): Record<string, unknown>;
  useToast(): ToastLike;
  useReducedMotion(): boolean;
}

const NO_TOAST: ToastLike = Object.freeze({ success: () => undefined, error: () => undefined, info: () => undefined });

/** Same markup as the shared primitives, minus movement and toasts. */
export const FALLBACK_UI: ProjectsUi = Object.freeze({
  Presence: ({ show, as = 'div', id, className, children }: PresenceLikeProps) => (show ? h(as, { id, className }, children) : null),
  Skeleton: ({ shape = 'text', className }: SkeletonLikeProps) => h('span', { className: ['hq-skeleton', `hq-skeleton--${shape}`, className].filter(Boolean).join(' '), 'aria-hidden': true }),
  FieldError: ({ id, children, announce }: FieldErrorLikeProps) => (children ? h('p', { id, className: 'hq-field-error', role: announce ? 'alert' : undefined }, h('span', null, children)) : null),
  InlineNotice: ({ tone, title, children, actions = [], className }: NoticeLikeProps) => h('div', { className: ['hq-notice', `hq-notice--${tone}`, className].filter(Boolean).join(' '), role: tone === 'danger' ? 'alert' : 'status' },
    h('div', { className: 'hq-notice-text' }, h('strong', { className: 'hq-notice-title' }, title), children ? h('span', { className: 'hq-notice-description' }, children) : null),
    actions.length > 0 ? h('div', { className: 'hq-notice-actions' }, actions.map((action) => h('button', { key: action.label, type: 'button', className: 'hq-btn hq-btn--sm hq-btn--ghost', onClick: action.onAction }, action.label))) : null),
  fieldErrorProps: (id: string, error: unknown) => (error ? { 'aria-invalid': true, 'aria-describedby': id } : {}),
  useToast: () => NO_TOAST,
  useReducedMotion: () => false,
});

export const ProjectsUiContext = createContext<ProjectsUi>(FALLBACK_UI);

export const useProjectsUi = (): ProjectsUi => useContext(ProjectsUiContext);
