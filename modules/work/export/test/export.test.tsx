import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ServiceResponse } from '@hq/contracts/services';
import { WorkExport, type WorkExportPort } from '..';
import { WorkDomain } from '../../nav';
import { installPlanner, uninstallPlanner } from '../../nav/test/support';

afterEach(() => { cleanup(); uninstallPlanner(); });
const ok = (saved: boolean, status = 200): ServiceResponse<{ saved: boolean }> => ({ ok: true, status, body: { saved }, replayed: false });
const click = async (name = 'Export JSON') => act(async () => { fireEvent.click(screen.getByRole('button', { name })); });

it('is idle and makes no call on mount; exports only the explicitly selected format', async () => {
  const port = { export: vi.fn().mockResolvedValue(ok(true)) };
  render(<WorkExport port={port} />);
  expect(screen.getByRole('status').textContent).toContain('Ready to export');
  expect(port.export).not.toHaveBeenCalled();
  await click(); await click('Export Markdown');
  expect(port.export.mock.calls).toEqual([['json'], ['markdown']]);
  expect(screen.getByRole('status').textContent).toBe('Planner status 200 · Saved.');
});

it('explains absent-port unavailability and disables both buttons', async () => {
  render(<WorkExport />);
  expect(screen.getByRole('status').textContent).toContain('No Planner export connection');
  for (const button of screen.getAllByRole('button')) expect((button as HTMLButtonElement).disabled).toBe(true);
  await click();
  expect(screen.getByRole('status').textContent).toContain('unavailable');
  expect(screen.getByText(/import planning or replace-restore/)).toBeTruthy();
  expect(screen.getAllByRole('button')).toHaveLength(2);
  expect(screen.queryByRole('link')).toBeNull();
});

it('prevents duplicate clicks until the save result settles', async () => {
  let finish!: (result: ServiceResponse<{ saved: boolean }>) => void;
  const port = { export: vi.fn(() => new Promise<ServiceResponse<{ saved: boolean }>>(resolve => { finish = resolve; })) };
  render(<WorkExport port={port} />);
  await click(); await click('Export Markdown'); await click();
  expect(port.export).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status').textContent).toContain('Export in progress');
  for (const button of screen.getAllByRole('button')) expect((button as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { finish(ok(false, 201)); });
  expect(screen.getByRole('status').textContent).toBe('Planner status 201 · Cancelled. Nothing saved.');
});

it.each([199, 300, 403, 500])('shows Planner status %i as an error even if saved is true', async status => {
  const port = { export: vi.fn().mockResolvedValue(ok(true, status)) };
  render(<WorkExport port={port} />); await click();
  expect(screen.getByRole('status').textContent).toBe(`Planner status ${status} · Export failed. Nothing saved.`);
  expect(port.export).toHaveBeenCalledTimes(1);
});

it.each(['unavailable', 'unknown'] as const)('preserves the %s boundary without an automatic retry', async kind => {
  const port = { export: vi.fn().mockResolvedValue({ ok: false, kind }) };
  render(<WorkExport port={port} />); await click();
  expect(screen.getByRole('status').textContent).toContain(kind);
  expect(port.export).toHaveBeenCalledTimes(1);
});

it('does not render exception text, extra paths or exported bytes', async () => {
  const extra = { ...ok(true), body: { saved: true, path: 'SYNTHETIC_PATH_SENTINEL', bytes: 'SYNTHETIC_BYTES_SENTINEL' } };
  const port = { export: vi.fn().mockResolvedValueOnce(extra).mockRejectedValueOnce(new Error('SYNTHETIC_EXCEPTION_SENTINEL')) };
  render(<WorkExport port={port} />); await click();
  expect(screen.getByRole('status').textContent).toContain('Saved.');
  await click();
  expect(screen.getByRole('status').textContent).toContain('unavailable');
  expect(document.body.textContent).not.toMatch(/SYNTHETIC_.*_SENTINEL/);
});

it('rejects malformed successful responses instead of claiming saved or cancelled', async () => {
  const port = { export: vi.fn().mockResolvedValue({ ok: true, status: 200, body: {}, replayed: false }) };
  render(<WorkExport port={port} />); await click();
  expect(screen.getByRole('status').textContent).toContain('unavailable');
});

it('does not attribute an old port result to a replacement connection', async () => {
  let finish!: (result: ServiceResponse<{ saved: boolean }>) => void;
  const original: WorkExportPort = { export: () => new Promise(resolve => { finish = resolve; }) };
  const replacement = { export: vi.fn().mockResolvedValue(ok(true)) };
  const view = render(<WorkExport port={original} />); await click();
  view.rerender(<WorkExport port={replacement} />);
  await act(async () => { finish(ok(true)); });
  expect(screen.getByRole('status').textContent).toContain('Ready to export');
  expect(replacement.export).not.toHaveBeenCalled();
});

it('nav-only optional mount exports on settings clicks, never navigation or reference opening', async () => {
  const { recorded } = installPlanner();
  const port = { export: vi.fn().mockResolvedValue(ok(true)) };
  const navigate = vi.fn();
  const props = { context: { id: 'synthetic-export-project', name: 'Synthetic' }, appearance: 'light' as const,
    desktop: { platform: 'browser' as const, versions: { electron: null } }, navigate, workExport: port };
  const view = render(<WorkDomain {...props} destination="board" />);
  await act(async () => { await Promise.resolve(); });
  view.rerender(<WorkDomain {...props} destination="settings" />);
  expect(port.export).not.toHaveBeenCalled();
  await click('Export Markdown');
  expect(port.export.mock.calls).toEqual([['markdown']]);
  view.rerender(<WorkDomain {...props} destination="item/missing-synthetic" />);
  view.rerender(<WorkDomain {...props} destination="settings" />);
  expect(port.export).toHaveBeenCalledTimes(1);
  expect(recorded.writes()).toEqual([]);
  expect(recorded.execution()).toEqual([]);
  expect(navigate).not.toHaveBeenCalled();
});
