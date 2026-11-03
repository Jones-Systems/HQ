import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ToastStoreProvider, createToastStore, type ToastStore } from '@hq/ui';
import { ProjectSources } from './ProjectSources';
afterEach(() => { cleanup(); Reflect.deleteProperty(window, 'hqServices'); });
it('enrolls gallery only on explicit submit and clears its private address afterward', async () => {
  const call = vi.fn(async (_route: string, _params: unknown) => ({ ok: true, value: [] }));
  Object.defineProperty(window, 'hqServices', { configurable: true, value: { sources: { call } } });
  render(<ProjectSources />);
  await waitFor(() => expect(call).toHaveBeenCalledWith('status', {}));
  fireEvent.click(screen.getByRole('button', { name: 'Enroll a gallery…' }));
  fireEvent.change(screen.getByLabelText('Gallery base URL'), { target: { value: 'https://example.com/gallery/' } });
  expect(call).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Enroll gallery' }));
  await waitFor(() => expect(call).toHaveBeenCalledWith('enrollGallery', { baseUrl: 'https://example.com/gallery/', label: 'Gallery' }));
  await waitFor(() => expect((screen.getByLabelText('Gallery base URL') as HTMLInputElement).value).toBe(''));
  expect(call.mock.calls.some(([route]) => String(route).includes('send'))).toBe(false);
});

const sourcesOk = (call: (route: string, params: unknown) => unknown) => ({ call: vi.fn(async (route: string, params: unknown) => call(route, params)) });
const jonesStatus = (state: string) => ({ ok: true, value: { state, profiles: [], destinations: [], descriptor: { kind: 'jones-code', label: 'Jones Code', provenance: 'jones', modes: [], qualification: { level: 'unqualified', reason: 'Not qualified.' } } } });
function mount(services: Record<string, unknown>) {
  Object.defineProperty(window, 'hqServices', { configurable: true, value: services });
  const store: ToastStore = createToastStore();
  render(<ToastStoreProvider store={store}><ProjectSources /></ToastStoreProvider>);
  return store;
}

it('stacks every form label above its control, associated by id (X16)', async () => {
  mount({ sources: sourcesOk(() => ({ ok: true, value: [] })), jonesCode: { call: vi.fn(async () => jonesStatus('not-configured')) } });
  fireEvent.click(await screen.findByRole('button', { name: 'Enroll a gallery…' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save a connection…' }));
  for (const name of ['Gallery label', 'Gallery base URL', 'Environment label', 'Jones server URL']) {
    const control = screen.getByLabelText(name);
    const field = control.closest('.settings-field')!;
    const label = field.querySelector('label')!;
    expect(label.textContent).toBe(name);
    expect(label.getAttribute('for')).toBe(control.id);
    expect(label.nextElementSibling).toBe(control);
    expect(field.parentElement?.classList.contains('settings-form')).toBe(true);
  }
});

it('moves focus into a disclosure when it opens and back to its button on Escape', async () => {
  mount({ sources: sourcesOk(() => ({ ok: true, value: [] })) });
  const trigger = await screen.findByRole('button', { name: 'Enroll a gallery…' });
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(trigger);
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  const label = screen.getByLabelText('Gallery label');
  expect(document.activeElement).toBe(label);
  fireEvent.keyDown(label, { key: 'Escape' });
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(trigger);
});

it('enrolls a gallery once per activation, confirms with a toast and flashes nothing it did not change', async () => {
  let release!: (value: unknown) => void;
  const call = vi.fn((route: string) => route === 'enrollGallery' ? new Promise(resolve => { release = resolve; }) : Promise.resolve({ ok: true, value: [] }));
  const store = mount({ sources: { call } });
  fireEvent.click(await screen.findByRole('button', { name: 'Enroll a gallery…' }));
  fireEvent.change(screen.getByLabelText('Gallery base URL'), { target: { value: 'https://example.com/gallery/' } });
  const submit = screen.getByRole('button', { name: 'Enroll gallery' });
  fireEvent.click(submit); fireEvent.click(submit);
  await waitFor(() => expect(submit.getAttribute('aria-busy')).toBe('true'));
  expect(call.mock.calls.filter(([route]) => route === 'enrollGallery')).toHaveLength(1);
  const local = screen.getByRole('button', { name: 'Choose local projects folder…' });
  expect(local.getAttribute('aria-disabled')).toBe('true');
  expect(document.getElementById(local.getAttribute('aria-describedby')!)?.textContent).toBe('Another action is in progress.');
  await act(async () => { release({ ok: true, value: [] }); });
  await waitFor(() => expect(store.getSnapshot()).toEqual([expect.objectContaining({ tone: 'success', title: 'Gallery enrolled' })]));
});

it('keeps a refused gallery in the form with its address, and says nothing was changed', async () => {
  const store = mount({ sources: sourcesOk(route => route === 'enrollGallery' ? { ok: false, kind: 'invalid' } : { ok: true, value: [] }) });
  fireEvent.click(await screen.findByRole('button', { name: 'Enroll a gallery…' }));
  const url = screen.getByLabelText('Gallery base URL') as HTMLInputElement;
  fireEvent.change(url, { target: { value: 'http://example.com/gallery/' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enroll gallery' }));
  await waitFor(() => expect(store.getSnapshot()).toHaveLength(1));
  expect(store.getSnapshot()[0]).toMatchObject({ tone: 'danger', description: expect.stringContaining('nothing was changed') });
  expect(url.value).toBe('http://example.com/gallery/');
  expect(url.getAttribute('aria-invalid')).toBe('true');
});

it('states why Jones actions are unavailable until a connection is saved and authorized', async () => {
  mount({ sources: sourcesOk(() => ({ ok: true, value: [] })), jonesCode: { call: vi.fn(async () => jonesStatus('not-configured')) } });
  await screen.findByText('Not set up');
  const reasonOf = (button: HTMLElement) => document.getElementById(button.getAttribute('aria-describedby')!)?.textContent;
  for (const [name, reason] of [['Authorize in browser…', 'Save a Jones connection first.'], ['Read Jones projects', 'Save a Jones connection first.'], ['Enroll Jones projects', 'Save a Jones connection first.']] as const) {
    const button = screen.getByRole('button', { name });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    button.focus();
    expect(document.activeElement).toBe(button);
    expect(reasonOf(button)).toBe(reason);
  }
  fireEvent.click(screen.getByRole('button', { name: 'Read Jones projects' }));
  expect(screen.queryByLabelText('Request destination project')).toBeNull();
});

it('keeps both sections and states why when native enrollment and Jones are missing', async () => {
  mount({});
  expect(screen.getByRole('heading', { name: 'Project sources' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Jones change requests' })).toBeTruthy();
  for (const name of ['Choose local projects folder…', 'Enroll a gallery…']) {
    const button = screen.getByRole('button', { name });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe("Native source enrollment isn't available in this window.");
  }
  const authorize = screen.getByRole('button', { name: 'Authorize in browser…' });
  expect(document.getElementById(authorize.getAttribute('aria-describedby')!)?.textContent).toBe("Native Jones connection isn't available in this window.");
});
