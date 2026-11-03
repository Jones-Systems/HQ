/**
 * The fictional file for the example workspace's import desk, so the check can be tried without a file on disk. It goes
 * through exactly the same check as a file the user chooses. Nothing here is real data.
 */

const FEED = {
  version: 'https://jsonfeed.org/version/1.1',
  title: 'Fictional neighborhood tea items',
  items: [
    { id: 'example-item-1', title: 'A corner shop tries cold-brew oolong', content_text: 'A fictional shop compared three steeping times. Customer preference is unknown.', url: 'https://example.invalid/cold-brew' },
    { id: 'example-item-2', title: 'A market stall adds a tasting flight', content_text: 'A fictional stall pours three oolongs side by side.', url: 'https://example.invalid/tasting-flight' },
    { id: 'example-item-3', title: 'A reading group meets over steeped leaves', content_text: 'A fictional group swaps notes on slow mornings.', url: 'https://example.invalid/reading-group' },
  ],
};

export const EXAMPLE_FILE_NAME = 'example-signal-items.json';

export function exampleFile(): File {
  return new File([`${JSON.stringify(FEED, null, 2)}\n`], EXAMPLE_FILE_NAME, { type: 'application/json' });
}
