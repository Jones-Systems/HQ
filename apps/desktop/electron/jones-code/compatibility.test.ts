import { expect, it, vi } from 'vitest';
import { assessCompatibility, JONES_WIRE_SOURCE, probeCompatibility } from './compatibility';
const identity = { environmentId: 'synthetic-environment', serverVersion: 'synthetic-version' };
const descriptor = { ...identity, orchestrationProtocolVersion: 2, jonesSource: JONES_WIRE_SOURCE };
const tool = (name: string, fields: Record<string, string>, required: string[] = [], enums: Record<string, string[]> = {}) => ({ name, inputSchema: { type: 'object', properties: Object.fromEntries(Object.entries(fields).map(([key, type]) => [key, { type, ...(enums[key] ? { enum: enums[key] } : {}) }])), required } });
const listing = { tools: [
  tool('t3_environment_read', {}),
  tool('t3_thread_read', { threadId: 'string', view: 'string', afterPosition: 'integer', limit: 'integer', runLimit: 'integer', maxCharsPerItem: 'integer' }, ['threadId'], { view: ['messages', 'activity'] }),
  tool('t3_thread_send', { threadId: 'string', message: 'string', mode: 'string', clientRequestId: 'string' }, ['threadId', 'message'], { mode: ['auto', 'queue'] }),
  tool('t3_queue_list', { threadId: 'string', limit: 'integer' }),
  tool('t3_thread_launch', { projectId: 'string', title: 'string', message: 'string', clientRequestId: 'string' }, ['title']),
  tool('t3_thread_launch_lookup', { clientRequestId: 'string' }, ['clientRequestId']),
  tool('t3_thread_launch_fence', { clientRequestId: 'string' }, ['clientRequestId']),
] };
it('automatically derives both modes for the release-qualified source and live schemas', () => {
  expect(assessCompatibility(identity, descriptor, listing).modes).toEqual(['existing-thread', 'new-thread']);
});
it.each([
  { ...descriptor, jonesSource: { ...JONES_WIRE_SOURCE, sha: '0'.repeat(40) } },
  { ...descriptor, jonesSource: { ...JONES_WIRE_SOURCE, tree: '0'.repeat(40) } },
  { ...descriptor, environmentId: 'other' },
  { ...descriptor, serverVersion: 'changed' },
  { ...descriptor, orchestrationProtocolVersion: 1 },
  {},
])('keeps older, changed and mismatched environments read-only', value => {
  expect(assessCompatibility(identity, value, listing).modes).toEqual([]);
});
it('does not infer keyed launch support from tool names without the keyed schema', () => {
  const older = { tools: listing.tools.map(value => value.name === 't3_thread_launch' ? tool(value.name, { projectId: 'string', title: 'string', message: 'string' }, ['title']) : value) };
  expect(assessCompatibility(identity, descriptor, older).modes).toEqual(['existing-thread']);
});
it.each([{ tools: [] }, { ...listing, nextCursor: 'more' }, { tools: [...listing.tools, listing.tools[0]] }, { tools: [{ name: 'malformed' }] }])('rejects incomplete or malformed capabilities', value => {
  expect(assessCompatibility(identity, descriptor, value).modes).toEqual([]);
});
it('uses read-only probes and never calls launch or send on unsupported servers', async () => {
  const call = vi.fn(async () => identity), inspect = vi.fn(async () => ({ descriptor: { ...descriptor, jonesSource: {} }, tools: listing }));
  expect((await probeCompatibility({ call, inspect })).compatibility.modes).toEqual([]);
  expect(call.mock.calls).toEqual([['t3_environment_read', {}]]);
});
