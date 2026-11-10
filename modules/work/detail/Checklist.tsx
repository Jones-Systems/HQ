import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button, IconButton } from '@hq/ui';
import { LIMITS, type NextStep, type StepInput } from '../core';

export interface ChecklistProps {
  steps: readonly NextStep[];
  /** Saves the whole list; resolves to an error message, or null when saved. */
  onSave(next: StepInput[]): Promise<string | null>;
  disabled?: boolean;
}

const UP = <svg viewBox="0 0 24 24"><path d="m6 14 6-6 6 6" /></svg>;
const DOWN = <svg viewBox="0 0 24 24"><path d="m6 10 6 6 6-6" /></svg>;
const REMOVE = <svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17" /></svg>;

/** Next steps with progress, add, edit, remove and reorder (buttons or Alt+↑/↓ on a step). */
export function Checklist({ steps, onSave, disabled }: ChecklistProps) {
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState('');
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const focusStep = useRef<string | null>(null);
  const done = steps.filter((step) => step.done).length;

  useLayoutEffect(() => {
    const id = focusStep.current;
    if (!id) return;
    const box = listRef.current?.querySelector<HTMLInputElement>(`[data-step-id="${CSS.escape(id)}"] input[type="checkbox"]`);
    if (box && document.activeElement !== box) box.focus();
    focusStep.current = null;
  });

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

  const commitText = (index: number, id: string) => {
    const text = texts[id];
    if (text === undefined) return;
    setTexts(({ [id]: _dropped, ...rest }) => rest);
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
      <p className="hq-meta" aria-live="polite">{steps.length ? `${done} of ${steps.length} done` : 'No steps yet'}</p>
      <ul className="work-steps" ref={listRef}>
        {steps.map((step, index) => (
          <li key={step.id} className="work-step" data-step-id={step.id} onKeyDown={onRowKey(index)}>
            <input
              type="checkbox"
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
            <IconButton size="sm" label="Move step up" icon={UP} disabled={disabled || index === 0} onClick={() => move(index, -1)} />
            <IconButton size="sm" label="Move step down" icon={DOWN} disabled={disabled || index === steps.length - 1} onClick={() => move(index, 1)} />
            <IconButton size="sm" label={`Remove step: ${step.text}`} icon={REMOVE} disabled={disabled} onClick={() => void save(current().filter((_, i) => i !== index))} />
          </li>
        ))}
      </ul>
      <span className="work-step-add">
        <input
          className="work-input"
          aria-label="New step"
          placeholder="Add a step"
          value={adding}
          maxLength={LIMITS.stepText}
          disabled={disabled || steps.length >= LIMITS.steps}
          onChange={(event) => setAdding(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(); } }}
        />
        <Button size="sm" onClick={add} disabled={disabled || !adding.trim()}>Add step</Button>
      </span>
      {error && <p className="work-field-error" role="alert">{error}</p>}
    </div>
  );
}
