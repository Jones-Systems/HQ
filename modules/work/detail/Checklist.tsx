import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button, FieldError, fieldErrorProps, IconButton, useListMotion } from '@hq/ui';
import { LIMITS, type NextStep, type StepInput } from '../core';
import { Present, useExiting, useMounted } from './exiting';

export interface ChecklistProps {
  steps: readonly NextStep[];
  /** Saves the whole list; resolves to an error message, or null when saved. */
  onSave(next: StepInput[]): Promise<string | null>;
  disabled?: boolean;
}

const UP = <svg viewBox="0 0 24 24"><path d="m6 14 6-6 6 6" /></svg>;
const DOWN = <svg viewBox="0 0 24 24"><path d="m6 10 6 6 6-6" /></svg>;
const REMOVE = <svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17" /></svg>;

/**
 * Next steps with progress, add, edit, remove and reorder (buttons or Alt+↑/↓ on a step). A new step rises in, a
 * removed one fades out and the rest glide up, a reordered step glides to its place, and ticking a step strikes its
 * text through. Every change still saves the whole list in one patch.
 */
export function Checklist({ steps, onSave, disabled }: ChecklistProps) {
  const id = useId();
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState('');
  const [error, setError] = useState<string | null>(null);
  const focusStep = useRef<string | null>(null);
  const progress = useRef<HTMLSpanElement>(null);
  const mounted = useMounted();
  const done = steps.filter((step) => step.done).length;
  const rows = useExiting(steps, (step) => step.id);
  const listRef = useListMotion<HTMLUListElement>(rows.map((row) => row.item.id), { animateEntering: false });

  useLayoutEffect(() => {
    const target = focusStep.current;
    if (!target) return;
    const box = listRef.current?.querySelector<HTMLInputElement>(`[data-step-id="${CSS.escape(target)}"] input[type="checkbox"]`);
    if (box && document.activeElement !== box) box.focus();
    focusStep.current = null;
  });

  // The bar's fill is a custom property set through CSSOM (the app CSP has no inline style attributes).
  useLayoutEffect(() => {
    progress.current?.style.setProperty('--wk-progress', steps.length ? String(done / steps.length) : '0');
  }, [done, steps.length]);

  const current = (): StepInput[] => steps.map((step) => ({ id: step.id, text: step.text, done: step.done }));
  const save = async (next: StepInput[]) => setError(await onSave(next));

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= steps.length) return;
    const next = current();
    const [step] = next.splice(index, 1);
    next.splice(target, 0, step!);
    focusStep.current = step!.id ?? null;
    void save(next);
  };

  const commitText = (index: number, stepId: string) => {
    const text = texts[stepId];
    if (text === undefined) return;
    setTexts(({ [stepId]: _dropped, ...rest }) => rest);
    if (text === steps[index]!.text) return;
    void save(current().map((step, i) => (i === index ? { ...step, text } : step)));
  };

  const onRowKey = (index: number) => (event: KeyboardEvent<HTMLElement>) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    move(index, event.key === 'ArrowUp' ? -1 : 1);
  };

  const add = () => {
    const text = adding.trim();
    if (!text) return;
    setAdding('');
    void save([...current(), { text, done: false }]);
  };

  return (
    <div className="work-checklist">
      <div className="work-checklist-head">
        <p className="hq-meta" aria-live="polite">{steps.length ? `${done} of ${steps.length} done` : 'No steps yet'}</p>
        {steps.length > 0 && <span className="work-progress" aria-hidden="true"><span className="work-progress-fill" ref={progress} /></span>}
      </div>
      <ul className="work-steps" ref={listRef}>
        {rows.map(({ item: step, leaving, onExited }) => {
          // Row numbers and moves refer to the live list, so a leaving row never takes part.
          const index = steps.findIndex((candidate) => candidate.id === step.id);
          return (
            <Present
              key={step.id} as="li" show={!leaving} motion="rise" initial={mounted.current} onExited={onExited}
              className={`work-step${step.done ? ' is-done' : ''}`} data-step-id={step.id} data-hq-motion-key={step.id}
              onKeyDown={onRowKey(index)}
            >
              <input
                type="checkbox"
                className="work-step-check"
                checked={step.done}
                disabled={disabled}
                aria-label={`Done: ${step.text}`}
                onChange={() => void save(current().map((s, i) => (i === index ? { ...s, done: !s.done } : s)))}
              />
              <input
                className="work-input work-step-text"
                aria-label={`Step ${index + 1}`}
                value={texts[step.id] ?? step.text}
                maxLength={LIMITS.stepText}
                disabled={disabled}
                onChange={(event) => setTexts((all) => ({ ...all, [step.id]: event.target.value }))}
                onBlur={() => commitText(index, step.id)}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitText(index, step.id); } }}
              />
              <span className="work-step-actions">
                <IconButton size="sm" label="Move step up" icon={UP} disabled={disabled || index === 0} onClick={() => move(index, -1)} />
                <IconButton size="sm" label="Move step down" icon={DOWN} disabled={disabled || index === steps.length - 1} onClick={() => move(index, 1)} />
                <IconButton size="sm" label={`Remove step: ${step.text}`} icon={REMOVE} disabled={disabled} onClick={() => void save(current().filter((_, i) => i !== index))} />
              </span>
            </Present>
          );
        })}
      </ul>
      <span className="work-step-add">
        <input
          className="work-input"
          aria-label="New step"
          placeholder="Add a step"
          value={adding}
          maxLength={LIMITS.stepText}
          disabled={disabled || steps.length >= LIMITS.steps}
          {...fieldErrorProps(`${id}-error`, error)}
          onChange={(event) => setAdding(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(); } }}
        />
        <Button size="sm" onClick={add} disabled={disabled || !adding.trim()}>Add step</Button>
      </span>
      <FieldError id={`${id}-error`} announce>{error}</FieldError>
    </div>
  );
}
