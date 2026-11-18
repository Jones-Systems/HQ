import { record } from '../services.js';
import type { McpClient } from './wire.js';
export type DeliveryMode = 'existing-thread' | 'new-thread';
// Source and protocol policy is release-owned; enrolling a compatible profile needs no local policy file.
export const JONES_WIRE_SOURCE = { repository: 'Jones-Systems/Jones-Code', sha: '38ced3fb7857506779bf8f2f76af0ed1caf026db', tree: '4a47cb8810fc03c22133c6e8048616e47508f2e9' } as const;
export interface Compatibility { readonly modes: readonly DeliveryMode[]; readonly reason: string }
export function assessCompatibility(identity: unknown, descriptor: unknown, listing: unknown): Compatibility {
  const denied = (reason: string): Compatibility => ({ modes: [], reason });
  if (!record(identity) || typeof identity.environmentId !== 'string' || !identity.environmentId || !record(descriptor)
    || descriptor.environmentId !== identity.environmentId || typeof identity.serverVersion !== 'string' || descriptor.serverVersion !== identity.serverVersion) return denied('Environment identity could not be verified');
  const source = descriptor.jonesSource;
  if (!record(source) || Object.entries(JONES_WIRE_SOURCE).some(([key, value]) => source[key] !== value)
    || descriptor.orchestrationProtocolVersion !== 2) return denied('This Jones release is read-only until its delivery protocol is qualified');
  if (!record(listing) || !Array.isArray(listing.tools) || listing.tools.length > 500 || listing.nextCursor !== undefined) return denied('Delivery capabilities are unavailable');
  const tools = new Map<string, Record<string, unknown>>();
  for (const tool of listing.tools) {
    if (!record(tool) || typeof tool.name !== 'string' || tools.has(tool.name) || !record(tool.inputSchema)) return denied('Malformed delivery capabilities');
    tools.set(tool.name, tool.inputSchema);
  }
  function supports(name: string, fields: Record<string, string>, required: readonly string[] = [], enumField?: [string, string]) {
    const schema = tools.get(name); if (!schema || schema.type !== 'object' || !record(schema.properties)) return false;
    const properties = schema.properties;
    if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some(key => typeof key !== 'string' || !(key in fields)))) return false;
    if (required.some(key => !Array.isArray(schema.required) || !schema.required.includes(key))) return false;
    for (const [key, type] of Object.entries(fields)) if (!record(properties[key]) || properties[key].type !== type) return false;
    if (!enumField) return true;
    const field = properties[enumField[0]];
    return record(field) && Array.isArray(field.enum) && field.enum.includes(enumField[1]);
  }
  const common = supports('t3_environment_read', {}) && supports('t3_thread_read', { threadId: 'string', view: 'string', afterPosition: 'integer', limit: 'integer', runLimit: 'integer', maxCharsPerItem: 'integer' }, ['threadId'], ['view', 'messages']);
  const modes: DeliveryMode[] = [];
  if (common && supports('t3_thread_send', { threadId: 'string', message: 'string', mode: 'string', clientRequestId: 'string' }, ['threadId', 'message'], ['mode', 'queue']) && supports('t3_queue_list', { threadId: 'string', limit: 'integer' })) modes.push('existing-thread');
  if (common && supports('t3_thread_launch', { projectId: 'string', title: 'string', message: 'string', clientRequestId: 'string' }, ['title'])
    && supports('t3_thread_launch_lookup', { clientRequestId: 'string' }, ['clientRequestId']) && supports('t3_thread_launch_fence', { clientRequestId: 'string' }, ['clientRequestId'])) modes.push('new-thread');
  return { modes, reason: modes.length ? 'Live source, identity and delivery capabilities verified' : 'This Jones server does not expose the qualified delivery schema' };
}
export async function probeCompatibility(client: McpClient): Promise<{ identity: unknown; compatibility: Compatibility }> {
  const identity = await client.call('t3_environment_read', {});
  if (!client.inspect) return { identity, compatibility: { modes: [], reason: 'Delivery capabilities are unavailable' } };
  const { descriptor, tools } = await client.inspect();
  return { identity, compatibility: assessCompatibility(identity, descriptor, tools) };
}
