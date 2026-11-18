import { useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Button, IconButton } from '@hq/ui';
import { describeOrigin, describeShape, readImportFile, type ImportFormat, type ImportedValue } from './imports';

/** DOM ID of a form field, so a problem summary can move focus to it. */
export function fieldId(tool: string, field: string): string {
  return `sw-${tool}-${field.replaceAll('.', '-')}`;
}

interface FieldFrameProps {
  readonly id: string;
  readonly label: ReactNode;
  readonly hint?: ReactNode;
  readonly error?: string | undefined;
  readonly optional?: boolean;
  readonly children: ReactNode;
}

function FieldFrame({ id, label, hint, error, optional, children }: FieldFrameProps) {
  return (
    <div className={error ? 'sw-field sw-field--invalid' : 'sw-field'}>
      <label className="sw-label" htmlFor={id}>{label}{optional && <span className="sw-optional"> optional</span>}</label>
      {children}
      {hint && <p className="sw-hint" id={`${id}-hint`}>{hint}</p>}
      {error && <p className="sw-error" id={`${id}-error`}>{error}</p>}
    </div>
  );
}

function describedBy(id: string, hint: unknown, error: unknown): string | undefined {
  const ids = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ');
  return ids || undefined;
}

interface TextFieldProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly hint?: ReactNode;
  readonly error?: string | undefined;
  readonly placeholder?: string;
  readonly optional?: boolean;
  readonly multiline?: boolean;
  readonly rows?: number;
  readonly mono?: boolean;
}

export function TextField({ id, label, value, onChange, hint, error, placeholder, optional, multiline, rows = 5, mono }: TextFieldProps) {
  const common = {
    id, value, placeholder, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy(id, hint, error),
    className: mono ? 'sw-input sw-input--mono' : 'sw-input',
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value),
  };
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} optional={optional}>
      {multiline ? <textarea {...common} rows={rows} spellCheck={!mono} /> : <input {...common} type="text" />}
    </FieldFrame>
  );
}

interface SelectFieldProps<V extends string> {
  readonly id: string;
  readonly label: string;
  readonly value: V;
  readonly options: readonly { readonly value: V; readonly label: string }[];
  readonly onChange: (value: V) => void;
  readonly hint?: ReactNode;
}

export function SelectField<V extends string>({ id, label, value, options, onChange, hint }: SelectFieldProps<V>) {
  return (
    <FieldFrame id={id} label={label} hint={hint}>
      <select id={id} className="sw-input" value={value} aria-describedby={describedBy(id, hint, undefined)} onChange={(event) => onChange(event.target.value as V)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </FieldFrame>
  );
}

interface TopicChipsProps {
  readonly id: string;
  readonly label: string;
  readonly values: readonly string[];
  readonly onChange: (values: string[]) => void;
  readonly hint?: ReactNode;
  readonly error?: string | undefined;
  readonly optional?: boolean;
}

/** Topic or term chips. Enter or a comma adds the typed text; each chip has its own Remove button. */
export function TopicChips({ id, label, values, onChange, hint, error, optional }: TopicChipsProps) {
  const [text, setText] = useState('');
  const add = () => {
    const next = text.split(',').map((value) => value.trim()).filter((value) => value !== '' && !values.includes(value));
    if (next.length) onChange([...values, ...next]);
    setText('');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add();
    } else if (event.key === 'Backspace' && text === '' && values.length) {
      onChange(values.slice(0, -1));
    }
  };
  return (
    <FieldFrame id={id} label={label} hint={hint ?? 'Press Enter or type a comma to add.'} error={error} optional={optional}>
      <div className="sw-chips">
        <ul className="sw-chip-list" aria-label={`${label}: ${values.length} added`}>
          {values.map((value) => (
            <li key={value} className="sw-chip">
              <span>{value}</span>
              <IconButton size="sm" label={`Remove ${value}`} icon="×" onClick={() => onChange(values.filter((item) => item !== value))} />
            </li>
          ))}
        </ul>
        <input
          id={id} className="sw-input sw-chip-input" type="text" value={text}
          aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, true, error)}
          onChange={(event) => setText(event.target.value)} onKeyDown={onKeyDown} onBlur={add}
        />
      </div>
    </FieldFrame>
  );
}

interface ImportSlotProps {
  readonly id: string;
  readonly label: string;
  readonly hint?: ReactNode;
  readonly format?: ImportFormat;
  /** One slot value, or several for `multiple`. */
  readonly values: readonly ImportedValue[];
  readonly onAdd: (value: ImportedValue) => void;
  readonly onRemove: (index: number) => void;
  readonly multiple?: boolean;
  readonly error?: string | undefined;
  /** Slot-specific facts shown under the shape preview, such as a record count. */
  readonly facts?: (value: unknown) => readonly string[];
  readonly optional?: boolean;
}

/**
 * Typed file import with a shape preview. Reading a file is local; it never submits a run. A single-value
 * slot replaces its value when another file is chosen.
 */
export function ImportSlot({ id, label, hint, format = 'json', values, onAdd, onRemove, multiple, error, facts, optional }: ImportSlotProps) {
  const [readError, setReadError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const onFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = [...(input.files ?? [])];
    setReadError(null);
    setReading(true);
    try {
      for (const file of files) {
        const result = await readImportFile(file, format);
        if (result.ok) onAdd(result.imported);
        else setReadError(result.message);
      }
    } finally {
      setReading(false);
      input.value = '';
    }
  };
  const shownError = readError ?? error;
  return (
    <FieldFrame
      id={id} label={label} error={shownError ?? undefined} optional={optional}
      hint={<>{hint}{hint ? ' ' : ''}{format === 'json-or-jsonl' ? 'JSON or JSON Lines' : 'JSON'}, at most 2 MB.</>}
    >
      <input
        id={id} className="sw-file" type="file" multiple={multiple}
        accept={format === 'json-or-jsonl' ? '.json,.jsonl,.ndjson,application/json' : '.json,application/json'}
        aria-invalid={shownError ? true : undefined} aria-describedby={describedBy(id, true, shownError)}
        aria-busy={reading || undefined} onChange={(event) => void onFiles(event)}
      />
      {values.length > 0 && (
        <ul className="sw-previews" aria-label={`${label} preview`}>
          {values.map((value, index) => (
            <li key={index} className="sw-preview">
              <div>
                <p className="sw-preview-origin">{describeOrigin(value)}</p>
                <p className="sw-preview-shape">{describeShape(value.value)}</p>
                {facts?.(value.value).map((fact) => <p key={fact} className="sw-preview-fact">{fact}</p>)}
              </div>
              <Button size="sm" variant="ghost" onClick={() => onRemove(index)} aria-label={`Remove ${label}${values.length > 1 ? ` ${index + 1}` : ''}`}>Remove</Button>
            </li>
          ))}
        </ul>
      )}
    </FieldFrame>
  );
}
