/**
 * Fictional files for the example workspace's import desk, so every step can be tried without a file on disk.
 * They go through exactly the same check as a file the user chooses. Nothing here is real data.
 */

export type ExampleFileKind = 'valid' | 'broken';

const VALID = {
  version: 'https://jsonfeed.org/version/1.1',
  title: 'Fictional neighborhood tea items',
  items: [
    { id: 'example-item-1', title: 'A corner shop tries cold-brew oolong', content_text: 'A fictional shop compared three steeping times. Customer preference is unknown.', url: 'https://example.invalid/cold-brew' },
    { id: 'example-item-2', title: 'A market stall adds a tasting flight', content_text: 'A fictional stall pours three oolongs side by side.', url: 'https://example.invalid/tasting-flight' },
    { id: 'example-item-3', title: 'A reading group meets over steeped leaves', content_text: 'A fictional group swaps notes on slow mornings.', url: 'https://example.invalid/reading-group' },
  ],
};

/** A missing comma after the first item: the check reports line 5, column 5. */
const BROKEN = `{
  "version": "https://jsonfeed.org/version/1.1",
  "items": [
    { "id": "example-item-1", "title": "A line that forgets its comma" }
    { "id": "example-item-2", "title": "So the file stops here" }
  ]
}
`;

export function exampleFile(kind: ExampleFileKind): File {
  return kind === 'valid'
    ? new File([`${JSON.stringify(VALID, null, 2)}\n`], 'example-signal-items.json', { type: 'application/json' })
    : new File([BROKEN], 'example-broken-feed.json', { type: 'application/json' });
}

export const EXAMPLE_FILE_NAMES: readonly string[] = ['example-signal-items.json', 'example-broken-feed.json'];
