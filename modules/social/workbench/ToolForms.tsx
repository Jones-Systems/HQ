import { Button } from '@hq/ui';
import { codePoints, isJsonObject, type ToolId } from '../core';
import { ImportSlot, SelectField, TextField, TopicChips, fieldId } from './fields';
import type { ImportedValue } from './imports';
import {
  MAX_CAPTION, STUDIO_FORMATS, STUDIO_FORMAT_LABELS, TIKTOK_BATCHES, feedItems,
  type Problem, type SignalRow, type ToolFields, type ToolForm,
} from './inputs';

interface FormProps<T extends ToolId> {
  readonly fields: ToolFields[T];
  readonly update: (patch: Partial<ToolFields[T]>) => void;
  /** Problem text per field, shown once a Run was blocked. */
  readonly error: (field: string) => string | undefined;
}

function one(value: ImportedValue | null): readonly ImportedValue[] {
  return value ? [value] : [];
}

function count(value: unknown, key: string, noun: string): readonly string[] {
  if (!isJsonObject(value) || !Array.isArray(value[key])) return [];
  return [`${(value[key] as unknown[]).length} ${noun}`];
}

function StudioForm({ fields, update, error }: FormProps<'x-studio'>) {
  const id = (field: string) => fieldId('x-studio', field);
  return (
    <div className="sw-form">
      <TextField id={id('notes')} label="Rough notes" multiline rows={6} value={fields.notes} onChange={(notes) => update({ notes })} error={error('notes')} />
      <SelectField
        id={id('format')} label="Format" value={fields.format} onChange={(format) => update({ format })}
        options={STUDIO_FORMATS.map((format) => ({ value: format, label: STUDIO_FORMAT_LABELS[format] }))}
      />
      <TextField id={id('audience')} label="Audience" optional value={fields.audience} onChange={(audience) => update({ audience })} hint='Left blank, the tool uses "Readers".' />
      <TextField id={id('intent')} label="Intent" optional value={fields.intent} onChange={(intent) => update({ intent })} hint='Left blank, the tool uses "Explain supplied material".' />
    </div>
  );
}

function ChannelForm({ fields, update, error }: FormProps<'social-publisher'>) {
  const length = codePoints(fields.caption);
  return (
    <div className="sw-form">
      <TextField
        id={fieldId('social-publisher', 'caption')} label="Caption" multiline rows={6} value={fields.caption}
        onChange={(caption) => update({ caption })} error={error('caption')}
        hint={`${length.toLocaleString('en-US')} / ${MAX_CAPTION.toLocaleString('en-US')} characters. Checked against X, LinkedIn, Instagram, TikTok and Facebook text profiles.`}
      />
      <p className="sw-fixed"><b>Format</b> Text. This workbench checks text only; media checks stay in the native tool.</p>
    </div>
  );
}

const EMPTY_ROW: SignalRow = { id: '', title: '', content_text: '', url: '' };

function SignalForm({ fields, update, error }: FormProps<'x-intelligence'>) {
  const id = (field: string) => fieldId('x-intelligence', field);
  const setRow = (index: number, patch: Partial<SignalRow>) => update({ rows: fields.rows.map((row, at) => (at === index ? { ...row, ...patch } : row)) });
  return (
    <div className="sw-form">
      <TextField id={id('topic')} label="Topic name" value={fields.topic} onChange={(topic) => update({ topic })} error={error('topic')} />
      <TopicChips id={id('terms')} label="Matching terms" values={fields.terms} onChange={(terms) => update({ terms })} error={error('terms')} />
      <ImportSlot
        id={id('feed')} label="JSON Feed file" optional hint="Items from a JSON Feed you saved yourself; HQ fetches nothing."
        values={one(fields.feed)} onAdd={(feed) => update({ feed })} onRemove={() => update({ feed: null })} error={error('feed')}
        facts={(value) => { const items = feedItems(value); return items ? [`${items.length} feed items`] : []; }}
      />
      <fieldset className="sw-fieldset">
        <legend>Items you type</legend>
        {fields.rows.length === 0 && <p className="sw-hint">No typed items. Add one, or import a JSON Feed file above.</p>}
        {fields.rows.map((row, index) => (
          <div key={index} className="sw-row" role="group" aria-label={`Item ${index + 1}`}>
            <TextField id={id(`rows.${index}.id`)} label={`Item ${index + 1} ID`} value={row.id} onChange={(value) => setRow(index, { id: value })} error={error(`rows.${index}.id`)} />
            <TextField id={id(`rows.${index}.title`)} label="Title" optional value={row.title} onChange={(value) => setRow(index, { title: value })} />
            <TextField id={id(`rows.${index}.content_text`)} label="Text" multiline rows={3} value={row.content_text} onChange={(value) => setRow(index, { content_text: value })} error={error(`rows.${index}.content_text`)} />
            <TextField id={id(`rows.${index}.url`)} label="Link" optional value={row.url} onChange={(value) => setRow(index, { url: value })} hint="Recorded with the item; never opened or fetched." />
            <Button size="sm" variant="ghost" onClick={() => update({ rows: fields.rows.filter((_, at) => at !== index) })}>Remove item {index + 1}</Button>
          </div>
        ))}
        <Button id={id('rows')} size="sm" onClick={() => update({ rows: [...fields.rows, { ...EMPTY_ROW, id: `item-${fields.rows.length + 1}` }] })}>Add item</Button>
        {error('rows') && <p className="sw-error">{error('rows')}</p>}
      </fieldset>
    </div>
  );
}

function AsOfField({ tool, value, update, error, kind }: { tool: ToolId; value: string; update: (asOf: string) => void; error: string | undefined; kind: 'date' | 'datetime' }) {
  return (
    <TextField
      id={fieldId(tool, 'asOf')} label="Data as of" value={value} onChange={update} error={error} mono
      hint={kind === 'date' ? 'The date the supplied packets describe, YYYY-MM-DD.' : 'When the supplied data was observed, for example 2026-10-01T12:00:00Z. Results describe the data as of this time.'}
    />
  );
}

function TikTokForm({ fields, update, error }: FormProps<'tiktok-intelligence'>) {
  const id = (field: string) => fieldId('tiktok-intelligence', field);
  const setBatch = (index: number, patch: Partial<ToolFields['tiktok-intelligence']['batches'][number]>) => update({ batches: fields.batches.map((batch, at) => (at === index ? { ...batch, ...patch } : batch)) });
  return (
    <div className="sw-form">
      <ImportSlot id={id('niche')} label="Niche definition" values={one(fields.niche)} onAdd={(niche) => update({ niche })} onRemove={() => update({ niche: null })} error={error('niche')} />
      <AsOfField tool="tiktok-intelligence" kind="datetime" value={fields.asOf} update={(asOf) => update({ asOf })} error={error('asOf')} />
      <fieldset className="sw-fieldset">
        <legend>Snapshot batches ({fields.batches.length} of {TIKTOK_BATCHES.max})</legend>
        {fields.batches.map((batch, index) => (
          <div key={index} className="sw-row" role="group" aria-label={`Batch ${index + 1}`}>
            <ImportSlot id={id(`batches.${index}.manifest`)} label={`Batch ${index + 1} manifest`} values={one(batch.manifest)} onAdd={(manifest) => setBatch(index, { manifest })} onRemove={() => setBatch(index, { manifest: null })} error={error(`batches.${index}.manifest`)} />
            <ImportSlot id={id(`batches.${index}.records`)} label={`Batch ${index + 1} records`} values={one(batch.records)} onAdd={(records) => setBatch(index, { records })} onRemove={() => setBatch(index, { records: null })} error={error(`batches.${index}.records`)} facts={(value) => (Array.isArray(value) ? [`${value.length} records`] : [])} />
            {fields.batches.length > 1 && <Button size="sm" variant="ghost" onClick={() => update({ batches: fields.batches.filter((_, at) => at !== index) })}>Remove batch {index + 1}</Button>}
          </div>
        ))}
        <Button id={id('batches')} size="sm" disabled={fields.batches.length >= TIKTOK_BATCHES.max} onClick={() => update({ batches: [...fields.batches, { manifest: null, records: null }] })}>Add batch</Button>
        {error('batches') && <p className="sw-error">{error('batches')}</p>}
      </fieldset>
    </div>
  );
}

function SeoForm({ fields, update, error }: FormProps<'seo-studio'>) {
  const id = (field: string) => fieldId('seo-studio', field);
  return (
    <div className="sw-form">
      <ImportSlot id={id('config')} label="Site configuration" values={one(fields.config)} onAdd={(config) => update({ config })} onRemove={() => update({ config: null })} error={error('config')} />
      <ImportSlot
        id={id('packets')} label="Article packets" multiple hint="One packet per file, or a list of packets."
        values={fields.packets} onAdd={(packet) => update({ packets: [...fields.packets, packet] })}
        onRemove={(index) => update({ packets: fields.packets.filter((_, at) => at !== index) })} error={error('packets')}
        facts={(value) => [`${Array.isArray(value) ? value.length : 1} packets`]}
      />
      <AsOfField tool="seo-studio" kind="date" value={fields.asOf} update={(asOf) => update({ asOf })} error={error('asOf')} />
    </div>
  );
}

function VisibilityForm({ fields, update, error }: FormProps<'search-visibility'>) {
  const id = (field: string) => fieldId('search-visibility', field);
  const slot = (key: 'panel' | 'entities' | 'inventory', label: string) => (
    <ImportSlot id={id(key)} label={label} values={one(fields[key])} onAdd={(value) => update({ [key]: value })} onRemove={() => update({ [key]: null })} error={error(key)} />
  );
  return (
    <div className="sw-form">
      {slot('panel', 'Query panel')}
      {slot('entities', 'Entities')}
      {slot('inventory', 'Content inventory')}
      <ImportSlot
        id={id('answers')} label="Answer observations" format="json-or-jsonl" values={one(fields.answers)}
        onAdd={(answers) => update({ answers })} onRemove={() => update({ answers: null })} error={error('answers')}
        facts={(value) => (Array.isArray(value) ? [`${value.length} observations`] : [])}
      />
    </div>
  );
}

function RedditForm({ fields, update, error }: FormProps<'reddit-opportunities'>) {
  return (
    <div className="sw-form">
      <ImportSlot id={fieldId('reddit-opportunities', 'bundle')} label="Corpus bundle" values={one(fields.bundle)} onAdd={(bundle) => update({ bundle })} onRemove={() => update({ bundle: null })} error={error('bundle')} />
      <AsOfField tool="reddit-opportunities" kind="datetime" value={fields.asOf} update={(asOf) => update({ asOf })} error={error('asOf')} />
    </div>
  );
}

function CreatorForm({ fields, update, error }: FormProps<'creator-relationships'>) {
  const id = (field: string) => fieldId('creator-relationships', field);
  return (
    <div className="sw-form">
      <ImportSlot
        id={id('batch')} label="Creator batch" values={one(fields.batch)} onAdd={(batch) => update({ batch })} onRemove={() => update({ batch: null })} error={error('batch')}
        facts={(value) => [
          ...(isJsonObject(value) && typeof value.account_id === 'string' ? ['Account ID present'] : ['No account_id']),
          ...count(value, 'creators', 'creators'),
        ]}
      />
      <TopicChips id={id('nicheTopics')} label="Niche topics" values={fields.nicheTopics} onChange={(nicheTopics) => update({ nicheTopics })} error={error('nicheTopics')} />
      <TopicChips id={id('brandTopics')} label="Brand topics" optional values={fields.brandTopics} onChange={(brandTopics) => update({ brandTopics })} />
      <AsOfField tool="creator-relationships" kind="datetime" value={fields.asOf} update={(asOf) => update({ asOf })} error={error('asOf')} />
    </div>
  );
}

export interface ToolFormViewProps {
  readonly form: ToolForm;
  readonly onChange: (form: ToolForm) => void;
  readonly problems: readonly Problem[];
}

/** The form for one tool. Every change only edits local input; nothing here calls the Social service. */
export function ToolFormView({ form, onChange, problems }: ToolFormViewProps) {
  const error = (field: string) => problems.find((problem) => problem.field === field)?.message;
  const patch = <T extends ToolId>(current: ToolForm<T>) => (value: Partial<ToolFields[T]>) => onChange({ ...current, fields: { ...current.fields, ...value } } as ToolForm);
  switch (form.tool) {
    case 'x-studio': return <StudioForm fields={form.fields} update={patch(form)} error={error} />;
    case 'social-publisher': return <ChannelForm fields={form.fields} update={patch(form)} error={error} />;
    case 'x-intelligence': return <SignalForm fields={form.fields} update={patch(form)} error={error} />;
    case 'tiktok-intelligence': return <TikTokForm fields={form.fields} update={patch(form)} error={error} />;
    case 'seo-studio': return <SeoForm fields={form.fields} update={patch(form)} error={error} />;
    case 'search-visibility': return <VisibilityForm fields={form.fields} update={patch(form)} error={error} />;
    case 'reddit-opportunities': return <RedditForm fields={form.fields} update={patch(form)} error={error} />;
    case 'creator-relationships': return <CreatorForm fields={form.fields} update={patch(form)} error={error} />;
  }
}
