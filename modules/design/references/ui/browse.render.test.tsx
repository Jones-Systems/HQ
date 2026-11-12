// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { ReferenceLibraryPanel } from './ReferenceLibraryPanel.tsx';
import { ReferenceLibrary } from '../src/service.ts';
import { fakePorts } from '../src/fakes.ts';
import { appScreenshot, screenshot } from '../test/fixtures.ts';

const DATA_URL = 'data:image/png;base64,AA==';
const preview = () => DATA_URL;
afterEach(cleanup);

async function openLibrary(count = 3) {
  const library = await ReferenceLibrary.open(fakePorts());
  const ids: string[] = [];
  const candidates = [
    screenshot({ title: 'Alpha pricing' }),
    appScreenshot({ title: 'Bravo editor' }),
    screenshot({ title: 'Charlie settings', source: { kind: 'url', url: 'https://example.com/settings' }, asset: { ...screenshot().asset!, bytes: new TextEncoder().encode('charlie') } }),
  ].slice(0, count);
  for (const candidate of candidates) ids.push((await library.importReference(candidate) as { id: string }).id);
  return { library, ids };
}

const openButtons = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>('.hq-refs-open')];
const titles = (root: HTMLElement) => openButtons(root).map((button) => button.getAttribute('aria-label'));

test('Rate taste is offered on every card only when the owner view wires it, and sends the card as a subject', async () => {
  const { library, ids } = await openLibrary();
  const without = render(<ReferenceLibraryPanel library={library} currentProject={null} previewUrl={preview} />);
  expect(without.queryAllByRole('button', { name: 'Rate taste' })).toHaveLength(0);
  without.unmount();

  const onSendToTaste = vi.fn();
  const view = render(<ReferenceLibraryPanel library={library} currentProject={null} previewUrl={preview} onSendToTaste={onSendToTaste} />);
  const buttons = view.getAllByRole('button', { name: 'Rate taste' });
  expect(buttons).toHaveLength(3);
  await act(async () => { fireEvent.click(buttons[0]!); });
  expect(onSendToTaste).toHaveBeenCalledTimes(1);
  const subject = onSendToTaste.mock.calls[0]![0];
  expect(ids).toContain(subject.id);
  expect(subject).toMatchObject({ imageUrl: DATA_URL });
  expect(typeof subject.title).toBe('string');
  expect(subject.detail.length).toBeGreaterThan(0);
});

test('a card already waiting for a Taste rating says so, and only that card', async () => {
  const { library, ids } = await openLibrary();
  const view = render(<ReferenceLibraryPanel library={library} currentProject={null} previewUrl={preview} onSendToTaste={() => {}}
    queuedForTaste={[ids[1]!]} />);
  const chips = view.getAllByText('Queued for Taste');
  expect(chips).toHaveLength(1);
  expect(chips[0]!.closest('article')!.getAttribute('data-queued')).toBe('true');
  expect(view.container.querySelectorAll('article[data-queued]')).toHaveLength(1);
});

test('cards are one roving tab stop: arrows, Home and End move focus and the stop', async () => {
  const { library } = await openLibrary();
  const { container } = render(<ReferenceLibraryPanel library={library} currentProject={null} previewUrl={preview} onSendToTaste={() => {}} />);
  const grid = container.querySelector<HTMLElement>('ul[aria-label="Reference results"]')!;
  const stops = () => openButtons(container).map((button) => button.tabIndex);
  expect(stops()).toEqual([0, -1, -1]);
  // Footer actions are reachable only on the card that holds the stop.
  const footerTabs = () => [...container.querySelectorAll<HTMLElement>('.hq-refs-card-footer button')].map((button) => button.tabIndex);
  expect(footerTabs()).toEqual([0, 0, -1, -1, -1, -1]);

  const first = openButtons(container)[0]!;
  first.focus();
  await act(async () => { fireEvent.keyDown(first, { key: 'ArrowRight' }); });
  expect(document.activeElement).toBe(openButtons(container)[1]);
  expect(stops()).toEqual([-1, 0, -1]);
  await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'End' }); });
  expect(document.activeElement).toBe(openButtons(container)[2]);
  await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'Home' }); });
  expect(document.activeElement).toBe(openButtons(container)[0]);
  await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' }); });
  expect(document.activeElement).toBe(openButtons(container)[0]);
  // Modified arrows belong to the browser and the assistive tech, not the grid.
  await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight', ctrlKey: true }); });
  expect(document.activeElement).toBe(openButtons(container)[0]);
  expect(grid.getAttribute('aria-label')).toBe('Reference results');
});

test('a card opens a lightbox; arrows step through the results; Escape closes it and focus returns to the open card', async () => {
  const { library } = await openLibrary();
  const { container, getByRole, queryByRole } = render(<ReferenceLibraryPanel library={library} currentProject={null} previewUrl={preview}
    onSendToTaste={() => {}} />);
  const order = titles(container);
  expect(queryByRole('dialog')).toBeNull();

  await act(async () => { fireEvent.click(openButtons(container)[0]!); });
  const dialog = getByRole('dialog');
  const headingNode = () => within(getByRole('dialog')).getByRole('heading', { level: 3 });
  const heading = () => headingNode().textContent;
  expect(heading()).toBe(order[0]!.replace('Show details for ', ''));
  expect(within(dialog).getByText('1 of 3')).toBeTruthy();
  expect(within(dialog).getByText('Provenance')).toBeTruthy();
  expect(within(dialog).getByRole('button', { name: 'Previous reference' }).hasAttribute('disabled')).toBe(true);

  await act(async () => { fireEvent.keyDown(headingNode(), { key: 'ArrowRight' }); });
  expect(within(getByRole('dialog')).getByText('2 of 3')).toBeTruthy();
  expect(heading()).toBe(order[1]!.replace('Show details for ', ''));
  await act(async () => { fireEvent.click(within(getByRole('dialog')).getByRole('button', { name: 'Next reference' })); });
  expect(within(getByRole('dialog')).getByText('3 of 3')).toBeTruthy();
  expect(within(getByRole('dialog')).getByRole('button', { name: 'Next reference' }).hasAttribute('disabled')).toBe(true);
  await act(async () => { fireEvent.keyDown(headingNode(), { key: 'ArrowLeft' }); });
  expect(within(getByRole('dialog')).getByText('2 of 3')).toBeTruthy();

  await act(async () => { fireEvent.keyDown(getByRole('dialog'), { key: 'Escape' }); });
  expect(queryByRole('dialog')).toBeNull();
  // Focus goes back to the card that was showing when the lightbox closed, not the one that opened it.
  expect(document.activeElement).toBe(openButtons(container)[1]);
});

test('the lightbox keeps the image untouched, shows provenance, and offers Rate taste', async () => {
  const { library } = await openLibrary(1);
  const onSendToTaste = vi.fn();
  const { container, getByRole } = render(<ReferenceLibraryPanel library={library} currentProject={null} previewUrl={preview}
    onSendToTaste={onSendToTaste} />);
  await act(async () => { fireEvent.click(openButtons(container)[0]!); });
  const dialog = getByRole('dialog');
  const image = dialog.querySelector<HTMLImageElement>('img.hq-refs-detail-image')!;
  expect(image.getAttribute('src')).toBe(DATA_URL);
  expect(image.hasAttribute('style')).toBe(false);
  expect(dialog.querySelector('.hq-refs-lightbox-stage')).not.toBeNull();
  expect(within(dialog).queryByText('1 of 1')).toBeTruthy();
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Rate taste' })); });
  expect(onSendToTaste).toHaveBeenCalledWith(expect.objectContaining({ imageUrl: DATA_URL }));
});

test('files dragged over the library show the drop overlay; a drop hands them to the importer; other drags are ignored', async () => {
  const { library } = await openLibrary();
  const onDropFiles = vi.fn();
  const { container, queryByText } = render(<ReferenceLibraryPanel library={library} currentProject={null} previewUrl={preview}
    onDropFiles={onDropFiles} />);
  const section = container.querySelector<HTMLElement>('section.hq-refs')!;
  const png = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' });

  await act(async () => { fireEvent.dragEnter(section, { dataTransfer: { types: ['text/plain'], files: [] } }); });
  expect(queryByText('Drop screenshots to import')).toBeNull();

  await act(async () => { fireEvent.dragEnter(section, { dataTransfer: { types: ['Files'], files: [png] } }); });
  expect(queryByText('Drop screenshots to import')).not.toBeNull();
  expect(container.querySelector('.hq-refs-drop')!.getAttribute('aria-hidden')).toBe('true');
  await act(async () => { fireEvent.dragLeave(section, { dataTransfer: { types: ['Files'], files: [png] } }); });
  expect(queryByText('Drop screenshots to import')).toBeNull();

  await act(async () => { fireEvent.dragEnter(section, { dataTransfer: { types: ['Files'], files: [png] } }); });
  await act(async () => { fireEvent.drop(section, { dataTransfer: { types: ['Files'], files: [png] } }); });
  expect(onDropFiles).toHaveBeenCalledTimes(1);
  expect(onDropFiles.mock.calls[0]![0]).toEqual([png]);
  expect(queryByText('Drop screenshots to import')).toBeNull();
});

test('without a drop handler the library does not claim file drags', async () => {
  const { library } = await openLibrary(1);
  const { container, queryByText } = render(<ReferenceLibraryPanel library={library} currentProject={null} previewUrl={preview} />);
  const section = container.querySelector<HTMLElement>('section.hq-refs')!;
  await act(async () => { fireEvent.dragEnter(section, { dataTransfer: { types: ['Files'], files: [] } }); });
  expect(queryByText('Drop screenshots to import')).toBeNull();
});

test('an empty library points at Imports for bundles, recordings and HTML, only when it is wired', async () => {
  const library = await ReferenceLibrary.open(fakePorts());
  const none = render(<ReferenceLibraryPanel library={library} currentProject={null} previewUrl={preview} />);
  expect(none.queryByText('Use Imports')).toBeNull();
  none.unmount();
  const onOpenImports = vi.fn();
  const view = render(<ReferenceLibraryPanel library={library} currentProject={null} previewUrl={preview} onOpenImports={onOpenImports}
    onDropFiles={() => {}} />);
  expect(view.getByText(/Importing a bundle, recordings or HTML\?/u)).toBeTruthy();
  expect(view.getByText('Drag screenshots here, or use Import screenshots.')).toBeTruthy();
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Use Imports' })); });
  expect(onOpenImports).toHaveBeenCalledTimes(1);
});
