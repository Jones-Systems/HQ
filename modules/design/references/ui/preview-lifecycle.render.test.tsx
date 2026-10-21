// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { ReferenceLibraryPanel } from './ReferenceLibraryPanel.tsx';
import { ReferenceLibrary } from '../src/service.ts';
import { fakePorts } from '../src/fakes.ts';
import { screenshot, appScreenshot } from '../test/fixtures.ts';

const noPreview = () => null;
afterEach(cleanup);

test('selection retains loaded img nodes and pending reads instead of blanking the library', async () => {
  const library = await ReferenceLibrary.open(fakePorts());
  await library.importReference(screenshot());
  await library.importReference(appScreenshot());
  const pending: ((src: string | null) => void)[] = [];
  const previewImage = vi.fn(() => new Promise<string | null>((resolve) => pending.push(resolve)));
  const { container } = render(<ReferenceLibraryPanel library={library} currentProject={null} previewUrl={noPreview} previewImage={previewImage} />);
  await act(async () => { pending.splice(0).forEach((resolve) => resolve('data:image/png;base64,first')); });
  await act(async () => { pending.splice(0).forEach((resolve) => resolve('data:image/png;base64,second')); });
  const images = [...container.querySelectorAll('.hq-refs-card img')];
  expect(images).toHaveLength(2);
  const reads = previewImage.mock.calls.length;
  const cards = container.querySelectorAll<HTMLButtonElement>('.hq-refs-open');
  expect(cards).toHaveLength(2);
  for (const card of cards) {
    await act(async () => { fireEvent.click(card); });
    expect([...container.querySelectorAll('.hq-refs-card img')]).toEqual(images);
    expect(previewImage).toHaveBeenCalledTimes(reads);
  }
});

test('pending selection is deduplicated; deleted assets and old providers cannot publish late images', async () => {
  const library = await ReferenceLibrary.open(fakePorts());
  const imported = await library.importReference(screenshot());
  if (imported.status === 'rejected') throw new Error('fixture import failed');
  let resolveOld!: (src: string | null) => void;
  const oldProvider = vi.fn(() => new Promise<string | null>((resolve) => { resolveOld = resolve; }));
  const props = { library, currentProject: null, previewUrl: noPreview };
  const mounted = render(<ReferenceLibraryPanel {...props} previewImage={oldProvider} />);
  await act(async () => {});
  await act(async () => { fireEvent.click(mounted.getByRole('button', { name: /^Show details for/ })); });
  expect(oldProvider).toHaveBeenCalledTimes(1);
  const nextProvider = vi.fn(async () => null);
  mounted.rerender(<ReferenceLibraryPanel {...props} previewImage={nextProvider} />);
  await act(async () => { resolveOld('data:image/png;base64,stale'); });
  expect(mounted.container.querySelectorAll('img')).toHaveLength(0);
  expect(nextProvider).toHaveBeenCalledTimes(1);
  await act(async () => { await library.deleteReference(imported.id); });
  expect(mounted.container.querySelectorAll('.hq-refs-card')).toHaveLength(0);
});
