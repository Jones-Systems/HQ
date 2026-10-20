import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { HqServices } from '@hq/contracts/services';
import type { ModulePort } from '@hq/contracts';
import * as Work from '@hq/work';
import { createServiceDomains, RELOAD_NOTE, selectService } from './services/domains';
import { createServices, sendHttp, type HttpCall, type Transport } from '../electron/services';
import type { ServiceConfig } from '../electron/service-config';
import { createLiveSocialPort } from '../../../modules/social/live';

let serial = 0;
const props = (): ModulePort => ({ context: { id: `integration-${++serial}`, name: 'Synthetic integration' }, destination: 'home', appearance: 'light', desktop: { platform: 'browser', versions: { electron: null } }, navigate: vi.fn() });
const configured = { configured: true, policy: 'ok', transport: 'loopback-http' } as const;
function bridge(social: URL, work: URL, transport: Transport = sendHttp): HqServices {
  const config: ServiceConfig = { get: domain => domain === 'social' ? social : work, status: () => configured, set: async () => configured };
  const main = createServices(config, transport);
  return { social: { call: main.social }, work: { call: main.work }, config: { status: async () => configured, set: async () => configured }, design: { call: async () => ({ ok: false, kind: 'unavailable' }) } };
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('selection requires an explicit unconfigured answer; malformed and failed bridges never select examples', async () => {
  const services = bridge(new URL('http://127.0.0.1'), new URL('http://127.0.0.1'), async () => ({ ok: false, kind: 'unavailable' }));
  for (const domain of ['social', 'work'] as const) {
    expect(await selectService(undefined, domain)).toBe('unavailable');
    expect(await selectService({ ...services, [domain]: {} } as HqServices, domain)).toBe('unavailable');
    expect(await selectService({ ...services, config: { ...services.config, status: async () => { throw new Error('lost'); } } }, domain)).toBe('unavailable');
    expect(await selectService({ ...services, config: { ...services.config, status: async () => ({ configured: false, policy: 'rejected', transport: null }) } }, domain)).toBe('unavailable');
    expect(await selectService(services, domain)).toBe('live');
  }
});
it('explicit unconfigured mounts labelled examples once; later settings changes wait for reload', async () => {
  const services = bridge(new URL('http://127.0.0.1'), new URL('http://127.0.0.1'), async () => ({ ok: false, kind: 'unavailable' }));
  const status = vi.fn().mockResolvedValue({ configured: false, policy: 'ok', transport: null });
  const bind = vi.spyOn(Work, 'setWorkSessionPort');
  const domains = createServiceDomains(() => ({ ...services, config: { ...services.config, status } }));
  const p = props(); const view = render(<domains.Work {...p} />);
  expect(await screen.findByText('Work: Synthetic example.')).toBeTruthy();
  expect(screen.getAllByText(RELOAD_NOTE)).toHaveLength(1);
  status.mockResolvedValue(configured); view.unmount();
  render(<domains.Work {...p} />);
  expect(await screen.findByText('Work: Synthetic example.')).toBeTruthy();
  expect(bind).toHaveBeenCalledTimes(1); expect(status).toHaveBeenCalledTimes(1);
  cleanup(); status.mockResolvedValue({ configured: false, policy: 'ok', transport: null });
  render(<domains.Social {...props()} />);
  expect(await screen.findByText('Social: Synthetic example.')).toBeTruthy();
});
it('failed status mounts unavailable surfaces without creating Work sessions or fixtures', async () => {
  const bind = vi.spyOn(Work, 'setWorkSessionPort');
  const domains = createServiceDomains(() => undefined);
  render(<><domains.Work {...props()} /><domains.Social {...props()} /></>);
  expect(await screen.findByText('Work: Unavailable — service is not configured correctly.')).toBeTruthy();
  expect(await screen.findByText('Social: Unavailable — service is not configured correctly.')).toBeTruthy();
  expect(screen.queryByText(/Fictional example/)).toBeNull(); expect(bind).not.toHaveBeenCalled();
});

describe('synthetic Social wire through the actual main HTTP layer', () => {
  it('mounts live; pins all six routes, exact token refresh, unknown counts and no fallback', async () => {
    const calls: string[] = []; let rejectBrand = true; let lose = false;
    const run = { id: '0123456789abcdef0123456789abcdef', tool: 'x-studio', status: 'queued', is_example: 1, created_at: '2026-01-01T00:00:00Z', finished_at: null, error: null };
    const server = createServer(async (req, res) => {
      calls.push(`${req.method} ${req.url}`);
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      if (lose) { res.destroy(); return; }
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/workspace') { res.end(JSON.stringify({ csrf: 'synthetic-token', brands: [], content: [], tools: [], runs: [] })); return; }
      if (req.method === 'POST') expect(req.headers['x-workspace-token']).toBe('synthetic-token');
      if (req.url === '/api/brands' && rejectBrand) { rejectBrand = false; res.statusCode = 403; res.end(JSON.stringify({ error: 'Reload the workspace before saving' })); return; }
      const answer = req.url === '/api/brands' ? { id: 'brand123', name: body.name }
        : req.url === '/api/content' ? { ...body, id: 'draft123', version: 1, updated_at: '2026-01-01T00:00:00Z' }
        : req.url?.startsWith('/api/sample/') ? { text: 'Synthetic input' } : run;
      res.end(JSON.stringify(answer));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = new URL(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
    try {
      const services = bridge(url, url); const domains = createServiceDomains(() => services);
      render(<domains.Social {...props()} />);
      expect(await screen.findByText('Social: Live service.')).toBeTruthy();
      await waitFor(() => expect(calls).toContain('GET /api/workspace'));
      const port = createLiveSocialPort(services.social);
      await port.snapshot();
      const before = calls.length; await port.addBrand('Synthetic');
      expect(calls.slice(before)).toEqual(['POST /api/brands', 'GET /api/workspace', 'POST /api/brands']);
      await port.example('x-studio'); await port.run('0123456789abcdef0123456789abcdef');
      await port.saveDraft({ title: 'Synthetic draft', body: 'Text', brand_id: '', channel: 'General', planned_date: '', archived: 0 });
      await port.submitRun('x-studio', {}, true);
      lose = true;
      for (const action of [() => port.addBrand('Lost brand'), () => port.saveDraft({ title: 'Lost draft', body: 'Text', brand_id: '', channel: 'General', planned_date: '', archived: 0 }), () => port.submitRun('x-studio', {}, true)]) {
        const count = calls.length; await expect(action()).rejects.toMatchObject({ error: { kind: 'unknown' } }); expect(calls.length).toBe(count + 1);
      }
      await expect(port.snapshot()).rejects.toMatchObject({ error: { kind: 'unavailable' } });
      expect(screen.queryByText(/Fictional example/)).toBeNull();
    } finally { cleanup(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});

it('shell binds the real disposable Planner: live reads, lost write, stable replay and no duplicate mutation', async () => {
  await mkdir('.t3/live-wiring', { recursive: true });
  const root = await mkdtemp(join(process.cwd(), '.t3/live-wiring/planner-'));
  const child = spawn('python3', ['-m', 'planning', '--data', join(root, 'planning.sqlite3'), '--host', '127.0.0.1', '--port', '0'], { cwd: 'services/planner', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  let output = ''; let stderr = ''; child.stderr.on('data', b => { stderr += b; });
  const exited = once(child, 'exit');
  try {
    const url = await new Promise<URL>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`UNKNOWN: Planner startup timed out: ${stderr}`)), 10_000);
      child.on('error', error => { clearTimeout(timer); reject(new Error(`UNKNOWN: Planner startup: ${error.message}`)); });
      child.on('exit', code => { clearTimeout(timer); reject(new Error(`UNKNOWN: Planner exited ${code}: ${stderr}`)); });
      child.stdout.on('data', b => { output += b; const match = /http:\/\/127\.0\.0\.1:\d+\//.exec(output); if (match) { clearTimeout(timer); resolve(new URL(match[0])); } });
    });
    const calls: HttpCall[] = []; let loseWrite = false; let loseRead = false;
    const transport: Transport = async (endpoint, call) => {
      calls.push(call);
      if (loseRead && call.method === 'GET') return { ok: false, kind: 'unavailable' };
      const response = await sendHttp(endpoint, call);
      return loseWrite && call.path === '/api/items' ? { ok: false, kind: 'unknown' } : response;
    };
    const bind = vi.spyOn(Work, 'setWorkSessionPort');
    const domains = createServiceDomains(() => bridge(url, url, transport));
    render(<domains.Work {...props()} />);
    expect(await screen.findByText('Work: Live service.')).toBeTruthy();
    await waitFor(() => expect(bind).toHaveBeenCalledTimes(1));
    const [port, options] = bind.mock.calls[0]!;
    const before = await port!.snapshot(); loseWrite = true;
    const requestId = 'synthetic-request-1234'; const fields = { title: 'Synthetic Planner task' };
    await expect(port!.create(fields, requestId)).rejects.toMatchObject({ error: { kind: 'unknown' } });
    await expect(port!.create(fields, requestId)).rejects.toMatchObject({ error: { kind: 'unknown' } });
    expect(calls.filter(c => c.path === '/api/items')).toHaveLength(1);
    const first = calls.find(c => c.path === '/api/items')!;
    expect(first.headers['X-Request-Id']).toBe(requestId);
    expect(await options!.recovery!.check(requestId)).toMatchObject({ outcome: 'replayed' });
    const replay = calls.find(c => c.path === '/api/requests/replay')!; const body = JSON.parse(replay.body!);
    expect(body).toMatchObject({ mode: 'lookup', request_id: requestId, sent_after_version: before.stateVersion });
    expect(Buffer.from(body.body_b64, 'base64').toString()).toBe(first.body);
    expect(replay.headers).not.toHaveProperty('X-Request-Id');
    expect((await port!.snapshot()).items.filter(item => item.title === fields.title)).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Capture to Inbox'), { target: { value: 'UI uncertain capture' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Quick capture' }));
    expect((await screen.findAllByText('1 unconfirmed')).length).toBeGreaterThan(0);
    expect(calls.filter(c => c.path === '/api/items')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
    await waitFor(() => expect(screen.queryAllByText('1 unconfirmed')).toHaveLength(0));
    expect(calls.filter(c => c.path === '/api/items')).toHaveLength(2);
    loseRead = true; await expect(port!.snapshot()).rejects.toMatchObject({ error: { kind: 'unavailable' } });
    expect(screen.queryByText(/Fictional example/)).toBeNull();
  } finally {
    cleanup(); if (child.exitCode === null) child.kill('SIGTERM'); await exited;
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);
