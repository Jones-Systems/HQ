import { PortFailure, FEATURE_HQ_BRAND_PROJECT, type Brand, type Draft, type RunRecord } from './port';
import { FEATURE_HQ_SOURCES, FEATURE_HQ_PUBLISHING, SOURCE_KINDS, validProjectId,
  type ExtendedSocialWorkspacePort, type SaveSource, type SourceContent, type SourceRecord,
  type SimulatedConnection, type PublishRequest } from './extensions';
import { isJsonObject } from './validate';

const invalid = (message: string): never => { throw new PortFailure({ kind: 'invalid', message }); };
const conflict = (message: string): never => { throw new PortFailure({ kind: 'conflict', message }); };
const missing = (): never => { throw new PortFailure({ kind: 'not_found' }); };
async function sha(text: string) {
  return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(v => v.toString(16).padStart(2, '0')).join('');
}
const canonical = (channel: string, title: string, body: string) => JSON.stringify({ body, channel, title });
const account = (channel: string) => ['X', 'LinkedIn', 'TikTok', 'Instagram', 'Facebook', 'Reddit'].includes(channel);
export function fixtureExtensions(state: {
  features: readonly string[]; brands: Brand[]; content: Draft[]; runs: () => RunRecord[]; now: () => string; id: () => string;
}) {
  const sources: SourceContent[] = [], connections: SimulatedConnection[] = [], requests: PublishRequest[] = [];
  const requireFeature = (feature: string) => { if (!state.features.includes(feature)) invalid(`Capability not available: ${feature}`); };
  const metadata = ({ content: _content, ...row }: SourceContent): SourceRecord => {
    const age = row.as_of === null ? null : Math.max(0, (Date.parse(state.now()) - Date.parse(row.as_of)) / 86400000);
    return { ...row, age_days: age === null ? null : Math.floor(age), status: age !== null && age > 30 ? 'stale' : 'valid',
      used_by_runs: state.runs().filter(r => r.source_ids?.includes(row.id)).slice(0, 20).map(r => r.id) };
  };
  const sourceById = (id: string) => sources.find(s => s.id === id) ?? missing();
  const connectionById = (id: string) => connections.find(s => s.id === id) ?? missing();
  const requestById = (id: string) => requests.find(s => s.id === id) ?? missing();
  const pending = (id: string) => { const r = requestById(id); if (r.status !== 'pending_approval') conflict('This request is no longer pending'); return r; };
  const invalidate = () => { for (const r of requests) {
    if (r.status === 'pending_approval' && state.content.find(d => d.id === r.draft_id)?.version !== r.draft_version) {
      r.status = 'invalidated'; r.decided_at = state.now();
    }
  } };
  const methods: Pick<ExtendedSocialWorkspacePort, 'setBrandProject' | 'source' | 'saveSource' | 'setSourceArchived' | 'connectChannel' | 'disconnectChannel' | 'requestPublish' | 'cancelPublish' | 'approvePublish'> = {
    async setBrandProject(id, project_id) {
      requireFeature(FEATURE_HQ_BRAND_PROJECT);
      if (!validProjectId(project_id)) invalid('Project ID must be 1–160 characters with no surrounding spaces');
      const brand = state.brands.find(b => b.id === id) ?? missing(); brand.project_id = project_id;
      return structuredClone(brand);
    },
    async source(id) { requireFeature(FEATURE_HQ_SOURCES); const r = sourceById(id); return structuredClone({ ...metadata(r), content: r.content }); },
    async saveSource(input: SaveSource) {
      requireFeature(FEATURE_HQ_SOURCES);
      for (const key of Object.keys(input)) if (!['name', 'kind', 'file_name', 'text', 'as_of'].includes(key)) invalid(`Unknown field: ${key}`);
      for (const [key, label, max] of [['name', 'Source name', 120], ['file_name', 'File name', 255]] as const) {
        if (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > max) invalid(`${label} must be text, 1–${max} characters`);
      }
      if (/[\/\\\u0000-\u001f\u007f-\u009f]/u.test(input.file_name)) invalid('File name must have no path separator or control character');
      if (!SOURCE_KINDS.includes(input.kind)) invalid('Unknown source kind');
      const bytes = new TextEncoder().encode(input.text).length;
      if (typeof input.text !== 'string' || bytes < 1 || bytes > 1500000) invalid('Source text must be 1–1,500,000 UTF-8 bytes');
      const parse = (raw: string, lineOffset = 0): unknown => {
        try {
          const value: unknown = JSON.parse(raw);
          const finite = (v: unknown): boolean => typeof v === 'number' ? Number.isFinite(v)
            : Array.isArray(v) ? v.every(finite) : isJsonObject(v) ? Object.values(v).every(finite) : true;
          if (!finite(value)) invalid('JSON line 1, column 1: invalid JSON value');
          return value;
        } catch (error) {
          if (error instanceof PortFailure) throw error;
          const message = error instanceof Error ? error.message : '';
          const match = /position (\d+)/u.exec(message);
          const position = match ? Number(match[1]) : raw.length;
          const prefix = raw.slice(0, position).split('\n');
          invalid(`JSON line ${lineOffset + prefix.length}, column ${prefix.at(-1)!.length + 1}: invalid JSON value`);
        }
      };
      let content: unknown;
      try { content = parse(input.text); } catch (error) {
        if (input.kind !== 'search-answers') throw error;
        try { content = input.text.split(/\r?\n/u).flatMap((s, i) => s.trim() ? [parse(s, i)] : []); }
        catch (error) { throw error; }
      }
      const listKinds = ['feed-items', 'tiktok-records', 'search-entities', 'search-inventory', 'search-answers'];
      const listField = ({ 'search-panel': 'queries', 'reddit-bundle': 'posts', 'creator-batch': 'creators' } as Record<string, string>)[input.kind];
      const main = listField && isJsonObject(content) ? content[listField] : content;
      if ((listKinds.includes(input.kind) || listField) ? !Array.isArray(main) : !isJsonObject(content)) invalid(`Source shape does not match ${input.kind}`);
      const as_of = input.as_of === '' ? (isJsonObject(content) ? content.as_of ?? null : null) : input.as_of;
      if (as_of !== null && (typeof as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.+)?$/u.test(as_of) || !Number.isFinite(Date.parse(as_of)))) invalid('Use an ISO-8601 as-of date');
      const sha256 = await sha(input.text);
      if (sources.some(s => s.kind === input.kind && s.sha256 === sha256)) conflict('This file is already saved as a source');
      const row: SourceContent = { id: state.id(), name: input.name, kind: input.kind, file_name: input.file_name,
        sha256, bytes, records: Array.isArray(main) ? main.length : 1, as_of: as_of as string | null,
        imported_at: state.now(), archived: 0, status: 'valid', age_days: null, used_by_runs: [], content };
      sources.unshift(row); return structuredClone(metadata(row));
    },
    async setSourceArchived(id, archived) { requireFeature(FEATURE_HQ_SOURCES); if (archived !== 0 && archived !== 1) invalid('Invalid archive state'); const r = sourceById(id); r.archived = archived; return structuredClone(metadata(r)); },
    async connectChannel(channel, label) {
      requireFeature(FEATURE_HQ_PUBLISHING);
      if (!account(channel)) invalid('Choose an account channel');
      if (typeof label !== 'string' || !label.trim() || label.length > 80) invalid('Channel label must be text, 1–80 characters');
      if (connections.length >= 50) conflict('Connection limit reached');
      const row: SimulatedConnection = { id: state.id(), channel, label, status: 'simulated', created_at: state.now(), disconnected_at: null };
      connections.unshift(row); return structuredClone(row);
    },
    async disconnectChannel(id) { requireFeature(FEATURE_HQ_PUBLISHING); const r = connectionById(id); r.status = 'disconnected'; r.disconnected_at = state.now(); return structuredClone(r); },
    async requestPublish(draftId, draftVersion, connectionId) {
      requireFeature(FEATURE_HQ_PUBLISHING);
      const draft = state.content.find(d => d.id === draftId);
      if (!draft || draft.version !== draftVersion) return conflict('This draft changed in another window. Close and reopen it before saving.');
      if (!account(draft.channel)) invalid('Choose a draft for an account channel');
      const c = connectionById(connectionId);
      if (c.status !== 'simulated' || c.channel !== draft.channel) invalid('Choose a simulated connection for this channel');
      const content = { title: draft.title, body: draft.body }, channel = c.channel;
      const content_sha256 = await sha(canonical(channel, content.title, content.body));
      const row: PublishRequest = { id: state.id(), connection_id: c.id, channel, draft_id: draftId,
        draft_version: draftVersion, content, content_sha256, status: 'pending_approval', created_at: state.now(), decided_at: null, receipt: null };
      requests.unshift(row); return structuredClone(row);
    },
    async cancelPublish(id) { requireFeature(FEATURE_HQ_PUBLISHING); const r = pending(id); r.status = 'cancelled'; r.decided_at = state.now(); return structuredClone(r); },
    async approvePublish(id, hash) {
      requireFeature(FEATURE_HQ_PUBLISHING); const r = pending(id);
      if (r.content_sha256 !== hash) conflict('The approved content does not match this request');
      if (state.content.find(d => d.id === r.draft_id)?.version !== r.draft_version) {
        r.status = 'invalidated'; r.decided_at = state.now(); conflict('The draft changed after this request; create a new request');
      }
      r.receipt = { simulated: true, delivered_at: state.now(), outbox_sequence: 1 + requests.filter(r => r.receipt).length, readback: 'simulated' };
      r.status = 'delivered_simulated'; r.decided_at = r.receipt.delivered_at; return structuredClone(r);
    },
  };
  return { methods, snapshot() { invalidate(); return {
    ...(state.features.includes(FEATURE_HQ_SOURCES) ? { sources: sources.slice(0, 500).map(metadata) } : {}),
    ...(state.features.includes(FEATURE_HQ_PUBLISHING) ? { publishing: { mode: 'simulator' as const, connections: structuredClone(connections), requests: structuredClone(requests.slice(0, 200)) } } : {}),
  }; }, checkSources(ids: readonly string[]) {
    requireFeature(FEATURE_HQ_SOURCES);
    if (!Array.isArray(ids) || ids.length > 20 || ids.some(id => !sources.some(s => s.id === id && !s.archived))) invalid('Unknown source');
  } };
}
