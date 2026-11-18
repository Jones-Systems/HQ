import { isJsonObject, isChannel } from '../core/validate';
import { SOURCE_KINDS, type SourceRecord, type SourceContent, type SimulatedConnection, type PublishRequest, type PublishingSnapshot } from '../core/extensions';
const str = (v: unknown): v is string => typeof v === 'string';
const nullable = (v: unknown) => v === null || str(v);
const integer = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
const hash = (v: unknown) => str(v) && /^[a-f0-9]{64}$/u.test(v);
const account = (v: unknown) => isChannel(v) && v !== 'General' && v !== 'Article';
export function guardSource(v: unknown): SourceRecord | null {
  if (!isJsonObject(v) || !str(v.id) || !str(v.name) || !SOURCE_KINDS.includes(v.kind as never)
    || !str(v.file_name) || !hash(v.sha256) || !integer(v.bytes) || !integer(v.records) || !nullable(v.as_of)
    || !str(v.imported_at) || (v.archived !== 0 && v.archived !== 1) || !['valid', 'stale'].includes(String(v.status))
    || !(v.age_days === null || integer(v.age_days)) || !Array.isArray(v.used_by_runs)
    || v.used_by_runs.length > 20 || !v.used_by_runs.every(str)) return null;
  const { content: _content, ...metadata } = v;
  return metadata as unknown as SourceRecord;
}
export function guardSourceContent(v: unknown): SourceContent | null {
  const metadata = guardSource(v);
  return metadata && isJsonObject(v) && 'content' in v ? { ...metadata, content: v.content } : null;
}
export function guardConnection(v: unknown): SimulatedConnection | null {
  if (!isJsonObject(v) || !str(v.id) || !account(v.channel) || !str(v.label)
    || !['simulated', 'disconnected'].includes(String(v.status)) || !str(v.created_at) || !nullable(v.disconnected_at)) return null;
  return v as unknown as SimulatedConnection;
}
export function guardPublish(v: unknown): PublishRequest | null {
  if (!isJsonObject(v) || !str(v.id) || !str(v.connection_id) || !account(v.channel) || !str(v.draft_id)
    || !integer(v.draft_version) || Number(v.draft_version) < 1 || !isJsonObject(v.content)
    || !str(v.content.title) || !str(v.content.body) || !hash(v.content_sha256)
    || !['pending_approval', 'cancelled', 'invalidated', 'delivered_simulated', 'failed'].includes(String(v.status))
    || !str(v.created_at) || !nullable(v.decided_at)) return null;
  if (v.receipt !== null && (!isJsonObject(v.receipt) || v.receipt.simulated !== true || !str(v.receipt.delivered_at)
    || !integer(v.receipt.outbox_sequence) || Number(v.receipt.outbox_sequence) < 1 || v.receipt.readback !== 'simulated')) return null;
  if ((v.status === 'delivered_simulated') !== (v.receipt !== null)) return null;
  return v as unknown as PublishRequest;
}
export function guardPublishing(v: unknown): PublishingSnapshot | null {
  if (!isJsonObject(v) || v.mode !== 'simulator' || !Array.isArray(v.connections) || v.connections.length > 50
    || !Array.isArray(v.requests) || v.requests.length > 200) return null;
  const connections = v.connections.map(guardConnection), requests = v.requests.map(guardPublish);
  if (connections.some(v => v === null) || requests.some(v => v === null)) return null;
  return { mode: 'simulator', connections: connections as SimulatedConnection[], requests: requests as PublishRequest[] };
}
