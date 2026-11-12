import { createElement as h, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { VIEW_KINDS, type ProjectContent, type ViewKind } from '../content.ts';
import type { ProjectsController } from '../controller.ts';
import { memoryFor } from '../session.ts';
import {
  kindLabel, validateProjectName, validateRoute, validateVersionLabel, validateViewTitle, VIEWPORT_PRESETS,
} from '../view-model.ts';
import { field, useSingleFlight } from './controls.ts';
import { useProjectsUi } from './ui.ts';

const onEscape = (close: () => void) => (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return;
  // The shell closes its own prompts on Escape; this one belongs to the form.
  event.stopPropagation();
  close();
};

const unsaved = 'Nothing was saved. What you typed is still in the form.';

/** Inline "New project" form. Enter creates, Escape cancels; the new project opens as soon as it exists. */
export function NewProjectForm({ controller, onClose }: { controller: ProjectsController; onClose: () => void }) {
  const ui = useProjectsUi();
  const toast = ui.useToast();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const { pending, run } = useSingleFlight();
  useEffect(() => { input.current?.focus(); }, []);
  const submit = (event: { preventDefault(): void }) => {
    event.preventDefault();
    const problem = validateProjectName(name);
    if (problem) { setError(problem); input.current?.focus(); return; }
    const trimmed = name.trim();
    setError(null);
    void run(async () => {
      const result = await controller.createProject(trimmed);
      if (result.ok) {
        toast.success(`Created “${trimmed}”`, { description: 'The project is open. Add a view to start collecting versions.' });
        onClose();
      } else {
        toast.error(`Couldn't create “${trimmed}”`, { description: `${result.error}. ${unsaved}` });
      }
    });
  };
  return h('form', { className: 'hqp-form', 'aria-label': 'New project', noValidate: true, onSubmit: submit, onKeyDown: onEscape(onClose) },
    field('Project name', ({ inputId, errorId }) => [
      h('input', {
        key: 'input', id: inputId, ref: input, value: name, placeholder: 'For example, Spring launch', autoComplete: 'off', readOnly: pending,
        onChange: (event: { target: { value: string } }) => { setName(event.target.value); if (error) setError(null); },
        ...ui.fieldErrorProps(errorId, error),
      }),
      h(ui.FieldError, { key: 'error', id: errorId }, error),
    ], true),
    h('div', { className: 'hqp-form-actions' },
      h('button', { type: 'submit', className: 'hq-btn hq-btn--primary', 'aria-busy': pending || undefined }, pending ? [h('span', { key: 'spin', className: 'hq-spinner', 'aria-hidden': true }), 'Creating'] : 'Create project'),
      h('button', { type: 'button', className: 'hq-btn hq-btn--ghost', onClick: onClose }, 'Cancel')));
}

/** Inline "Add view" form. */
export function AddViewForm({ controller, onClose, onAdded }: {
  controller: ProjectsController; onClose: () => void; onAdded: (view: { readonly id: string; readonly title: string }) => void;
}) {
  const ui = useProjectsUi();
  const toast = ui.useToast();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<ViewKind>('page');
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const { pending, run } = useSingleFlight();
  useEffect(() => { input.current?.focus(); }, []);
  const submit = (event: { preventDefault(): void }) => {
    event.preventDefault();
    const problem = validateViewTitle(title);
    if (problem) { setError(problem); input.current?.focus(); return; }
    const trimmed = title.trim();
    setError(null);
    void run(async () => {
      const result = await controller.addView(trimmed, kind);
      if (!result.ok) {
        toast.error(`Couldn't add “${trimmed}”`, { description: `${result.error}. ${unsaved}` });
        return;
      }
      const active = controller.getSnapshot().active;
      const added = active?.status === 'ready' ? active.content.views.at(-1) : undefined;
      toast.success(`Added view “${trimmed}”`, { description: 'Add a version to start its history.' });
      onClose();
      if (added) onAdded({ id: added.id, title: added.title });
    });
  };
  return h('form', { className: 'hqp-form', 'aria-label': 'Add view', noValidate: true, onSubmit: submit, onKeyDown: onEscape(onClose) },
    field('View title', ({ inputId, errorId }) => [
      h('input', {
        key: 'input', id: inputId, ref: input, value: title, placeholder: 'For example, Home', autoComplete: 'off', readOnly: pending,
        onChange: (event: { target: { value: string } }) => { setTitle(event.target.value); if (error) setError(null); },
        ...ui.fieldErrorProps(errorId, error),
      }),
      h(ui.FieldError, { key: 'error', id: errorId }, error),
    ], true),
    field('Kind', ({ inputId }) => h('select', {
      id: inputId, value: kind, disabled: pending, onChange: (event: { target: { value: string } }) => setKind(event.target.value as ViewKind),
    }, VIEW_KINDS.map((option) => h('option', { key: option, value: option }, kindLabel(option))))),
    h('div', { className: 'hqp-form-actions' },
      h('button', { type: 'submit', className: 'hq-btn hq-btn--primary', 'aria-busy': pending || undefined }, pending ? [h('span', { key: 'spin', className: 'hq-spinner', 'aria-hidden': true }), 'Adding'] : 'Add view'),
      h('button', { type: 'button', className: 'hq-btn hq-btn--ghost', onClick: onClose }, 'Cancel')));
}

/** Inline "Add version" form. A version is bound to a route and a capture viewport; earlier versions never change. */
export function AddVersionForm({ controller, content, defaultView, onClose, onAdded }: {
  controller: ProjectsController; content: ProjectContent; defaultView: string | null; onClose: () => void;
  onAdded: (version: { readonly id: string; readonly label: string }) => void;
}) {
  const ui = useProjectsUi();
  const toast = ui.useToast();
  const [viewId, setViewId] = useState(() => content.views.find((view) => view.id === defaultView)?.id ?? content.views[0]?.id ?? '');
  const [label, setLabel] = useState('');
  const [route, setRoute] = useState('/');
  const [preset, setPreset] = useState(VIEWPORT_PRESETS[0]!.id);
  const [errors, setErrors] = useState<{ label?: string; route?: string }>({});
  const labelInput = useRef<HTMLInputElement | null>(null);
  const routeInput = useRef<HTMLInputElement | null>(null);
  const { pending, run } = useSingleFlight();
  useEffect(() => { labelInput.current?.focus(); }, []);
  const target = content.views.find((view) => view.id === viewId) ?? content.views[0];
  if (!target) return null;
  const submit = (event: { preventDefault(): void }) => {
    event.preventDefault();
    const found = { label: validateVersionLabel(label), route: validateRoute(route) };
    if (found.label || found.route) {
      setErrors({ ...(found.label ? { label: found.label } : {}), ...(found.route ? { route: found.route } : {}) });
      (found.label ? labelInput : routeInput).current?.focus();
      return;
    }
    setErrors({});
    const viewport = VIEWPORT_PRESETS.find((candidate) => candidate.id === preset)?.viewport ?? VIEWPORT_PRESETS[0]!.viewport;
    const trimmed = label.trim();
    void run(async () => {
      const result = await controller.addVersion({
        viewId: target.id, label: trimmed, origin: 'owner-created', capture: { route: route.trim(), viewport },
      });
      if (!result.ok) {
        toast.error(`Couldn't add “${trimmed}”`, { description: `${result.error}. Earlier versions are unchanged. ${unsaved}` });
        return;
      }
      toast.success(`Added “${trimmed}” to ${target.title}`, { description: 'Versions are immutable. Earlier ones are unchanged.' });
      const selected = memoryFor(controller.getSnapshot().session, content.projectId).selection.versionId;
      onClose();
      if (selected) onAdded({ id: selected, label: trimmed });
    });
  };
  return h('form', { className: 'hqp-form', 'aria-label': 'Add version', noValidate: true, onSubmit: submit, onKeyDown: onEscape(onClose) },
    field('View', ({ inputId }) => h('select', {
      id: inputId, value: target.id, disabled: pending, onChange: (event: { target: { value: string } }) => setViewId(event.target.value),
    }, content.views.map((option) => h('option', { key: option.id, value: option.id }, option.title)))),
    field('Version label', ({ inputId, errorId }) => [
      h('input', {
        key: 'input', id: inputId, ref: labelInput, value: label, placeholder: 'For example, Hero first pass', autoComplete: 'off', readOnly: pending,
        onChange: (event: { target: { value: string } }) => { setLabel(event.target.value); if (errors.label) setErrors((current) => ({ ...current, label: undefined })); },
        ...ui.fieldErrorProps(errorId, errors.label),
      }),
      h(ui.FieldError, { key: 'error', id: errorId }, errors.label),
    ], true),
    field('Captured route', ({ inputId, errorId }) => [
      h('input', {
        key: 'input', id: inputId, ref: routeInput, value: route, placeholder: '/', autoComplete: 'off', readOnly: pending,
        onChange: (event: { target: { value: string } }) => { setRoute(event.target.value); if (errors.route) setErrors((current) => ({ ...current, route: undefined })); },
        ...ui.fieldErrorProps(errorId, errors.route),
      }),
      h(ui.FieldError, { key: 'error', id: errorId }, errors.route),
    ]),
    field('Viewport', ({ inputId }) => h('select', {
      id: inputId, value: preset, disabled: pending, onChange: (event: { target: { value: string } }) => setPreset(event.target.value),
    }, VIEWPORT_PRESETS.map((option) => h('option', { key: option.id, value: option.id }, option.label)))),
    h('div', { className: 'hqp-form-actions' },
      h('button', { type: 'submit', className: 'hq-btn hq-btn--primary', 'aria-busy': pending || undefined }, pending ? [h('span', { key: 'spin', className: 'hq-spinner', 'aria-hidden': true }), 'Adding'] : 'Add version'),
      h('button', { type: 'button', className: 'hq-btn hq-btn--ghost', onClick: onClose }, 'Cancel')));
}
