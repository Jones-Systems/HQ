// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { createToastStore, ToastStoreProvider, type ToastRecord } from '@hq/ui';
import { afterEach, expect, test, vi } from 'vitest';
import { ReferencesSection } from '../references/View.tsx';
import { createReferencesEnvironment } from '../references/env.ts';
import { compareSlot, doubles } from './doubles.ts';

const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
const png = Uint8Array.from(atob(pngBase64), (character) => character.charCodeAt(0));
/** The same valid 1×1 PNG with one data byte changed, so it has its own digest. */
const variant = (seed: number) => { const bytes = png.slice(); bytes[41] = seed; return bytes; };
const image = (name: string, bytes = png, type = 'image/png') => new File([bytes], name, { type, lastModified: Date.parse('2026-01-02T03:04:00Z') });

afterEach(cleanup);

async function mount(options: { onSendToTaste?: boolean } = {}) {
  const d = doubles();
  const env = await createReferencesEnvironment({ storage: d.referenceStorage, clock: d.clock, ids: d.ids, compareSlot, previewUrl: () => null,
    imageDecoder: async () => ({ w: 1, h: 1 }) });
  const store = createToastStore();
  const onSendToTaste = vi.fn();
  const view = render(<ToastStoreProvider store={store}>
    <ReferencesSection env={env} currentProject={null} onSendToTaste={options.onSendToTaste === false ? undefined : onSendToTaste} />
  </ToastStoreProvider>);
  const toasts = (): readonly ToastRecord[] => store.getSnapshot();
  const choose = async (...files: File[]) => {
    await act(async () => { fireEvent.change(view.getByLabelText('Choose a screenshot to import'), { target: { files } }); });
  };
  const fillWebsite = async (url = 'https://example.com/pricing') => {
    await act(async () => { fireEvent.change(view.getByLabelText('Website URL'), { target: { value: url } }); });
  };
  const rows = () => [...view.container.querySelectorAll<HTMLElement>('.hq-refs-queue-row')];
  const statuses = () => rows().map((row) => row.getAttribute('data-status'));
  return { d, env, store, view, toasts, choose, fillWebsite, rows, statuses, onSendToTaste };
}

test('choosing several images queues them all, with the first filling the form from its own file name', async () => {
  const { view, choose, rows, statuses } = await mount();
  const input = view.getByLabelText('Choose a screenshot to import') as HTMLInputElement;
  expect(input.multiple).toBe(true);
  expect(input.accept).toBe('image/png,image/jpeg,image/webp');
  await choose(image('lumen-pricing.png'), image('tern-settings.png', variant(7)));
  expect(rows()).toHaveLength(2);
  expect(statuses()).toEqual(['waiting', 'waiting']);
  expect(within(rows()[0]!).getByText('lumen-pricing.png')).toBeTruthy();
  expect(rows()[0]!.getAttribute('aria-current')).toBe('step');
  expect((view.getByLabelText('Title') as HTMLInputElement).value).toBe('lumen-pricing');
  expect(view.getByRole('button', { name: 'Skip this one' })).toBeTruthy();
  expect(view.getByText('2 images')).toBeTruthy();
});

test('an incomplete form is explained beside its fields, focuses the first, and imports nothing', async () => {
  const { env, view, choose, toasts } = await mount();
  await choose(image('a.png'));
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Import image' })); });
  const url = view.getByLabelText('Website URL');
  expect(view.getByText('Add the address of the website this came from.')).toBeTruthy();
  expect(url.getAttribute('aria-invalid')).toBe('true');
  expect(url.getAttribute('aria-describedby')).toBeTruthy();
  expect(document.activeElement).toBe(url);
  expect(Object.keys(env.library.state.references)).toHaveLength(0);
  expect(toasts()).toHaveLength(0);
  await act(async () => { fireEvent.change(url, { target: { value: 'not a url' } }); });
  expect(view.queryByText('Add the address of the website this came from.')).toBeNull();
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Import image' })); });
  expect(view.getByText(/starts with http:\/\/ or https:\/\//u)).toBeTruthy();
});

test('importing one image saves it, toasts "Saved “title”" with Rate taste, and moves the form to the next image', async () => {
  const { env, view, choose, fillWebsite, toasts, statuses, onSendToTaste } = await mount();
  await choose(image('first.png'), image('second.png', variant(9)));
  await fillWebsite();
  await act(async () => { fireEvent.change(view.getByLabelText('Title'), { target: { value: 'Pricing page' } }); });
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Import image' })); });
  await waitFor(() => expect(statuses()).toEqual(['saved', 'waiting']));
  expect(Object.values(env.library.state.references).map((record) => record.title)).toEqual(['Pricing page']);
  const saved = toasts().find((toast) => toast.title === 'Saved “Pricing page”');
  expect(saved?.tone).toBe('success');
  expect(saved?.action?.label).toBe('Rate taste');
  await act(async () => { saved!.action!.onAction(); });
  await waitFor(() => expect(onSendToTaste).toHaveBeenCalledTimes(1));
  expect(onSendToTaste.mock.calls[0]![0]).toMatchObject({ title: 'Pricing page', detail: 'example.com/pricing' });
  // The form is now filling in the second image, and the saved card is in the grid.
  expect((view.getByLabelText('Title') as HTMLInputElement).value).toBe('second');
  expect(view.container.querySelectorAll('.hq-refs-card')).toHaveLength(1);
});

test('the Rate taste action is only offered when the view can send to Taste', async () => {
  const { view, choose, fillWebsite, toasts, statuses } = await mount({ onSendToTaste: false });
  await choose(image('only.png'));
  await fillWebsite();
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Import image' })); });
  await waitFor(() => expect(statuses()).toEqual(['saved']));
  expect(toasts().find((toast) => toast.title === 'Saved “only”')?.action).toBeUndefined();
});

test('"Use these source details for the rest" imports every waiting image in turn behind one progress toast', async () => {
  const { env, view, choose, fillWebsite, toasts, statuses } = await mount();
  await choose(image('a.png', variant(1)), image('b.png', variant(2)), image('c.png', variant(3)));
  await fillWebsite('https://example.com/shared');
  await act(async () => { fireEvent.click(view.getByLabelText(/Use these source details for the rest/u)); });
  expect(view.getByRole('button', { name: 'Import 3 images' })).toBeTruthy();
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Import 3 images' })); });
  await waitFor(() => expect(statuses()).toEqual(['saved', 'saved', 'saved']));
  const records = Object.values(env.library.state.references);
  expect(records.map((record) => record.title).sort()).toEqual(['a', 'b', 'c']);
  expect(records.every((record) => record.source.kind === 'url')).toBe(true);
  const batch = toasts().filter((toast) => toast.id === 'design-references-import');
  expect(batch).toHaveLength(1);
  expect(batch[0]).toMatchObject({ tone: 'success', title: 'Saved 3 screenshots' });
});

test('an image already in the library is kept as it was, with the existing wording', async () => {
  const { view, choose, fillWebsite, toasts, statuses } = await mount();
  await choose(image('same.png'));
  await fillWebsite();
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Import image' })); });
  await waitFor(() => expect(statuses()).toEqual(['saved']));
  await choose(image('same-again.png'));
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Import image' })); });
  await waitFor(() => expect(statuses().at(-1)).toBe('kept-existing'));
  const kept = toasts().find((toast) => toast.tone === 'info');
  expect(kept?.title).toMatch(/already in your library/u);
  expect(view.container.querySelectorAll('.hq-refs-card')).toHaveLength(1);
});

test('dropping files queues the images and warns by name about the ones that cannot be imported', async () => {
  const { view, toasts, rows } = await mount();
  const section = view.container.querySelector<HTMLElement>('section.hq-refs')!;
  const files = [image('dropped.png'), new File(['hello'], 'notes.txt', { type: 'text/plain' }), new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })];
  await act(async () => { fireEvent.drop(section, { dataTransfer: { types: ['Files'], files } }); });
  expect(rows().map((row) => within(row).getByText(/\.png$/u).textContent)).toEqual(['dropped.png']);
  const warning = toasts().find((toast) => toast.tone === 'warning');
  expect(warning?.title).toBe('Skipped 2 files');
  expect(warning?.description).toContain('notes.txt');
  expect(warning?.description).toContain('logo.svg');
  expect(warning?.description).toContain('PNG, JPEG and WebP');
});

test('an unconfirmed save is shown as unknown, pauses importing, and Check reads the saved library again', async () => {
  const { d, env, view, choose, fillWebsite, toasts, statuses } = await mount();
  await choose(image('risky.png'), image('after.png', variant(5)));
  await fillWebsite();
  d.referenceStorage.failNextWrite = 'after-apply';
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Import image' })); });
  await waitFor(() => expect(statuses()[0]).toBe('unknown'));
  expect(toasts().find((toast) => toast.tone === 'unknown')?.action?.label).toBe('Check');
  expect(view.getByText('Importing is paused')).toBeTruthy();
  expect((view.getByRole('button', { name: 'Import screenshots' }) as HTMLButtonElement).disabled).toBe(true);
  expect((view.getByLabelText('Choose a screenshot to import') as HTMLInputElement).disabled).toBe(true);
  // Nothing more is imported while the last save is unconfirmed.
  expect((view.getByRole('button', { name: 'Import image' }) as HTMLButtonElement).disabled).toBe(true);

  const reload = vi.spyOn(env.library, 'reload');
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Reload saved library' })); });
  expect(reload).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(toasts().some((toast) => toast.title === 'Saved library reloaded')).toBe(true));
});
