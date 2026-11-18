import type { SocialSession, SocialSessionState } from '../../core';
import type { CheckedFile } from './check';

/**
 * Files checked on the Sources page. They live in the Social session's page view state: kept while HQ is open and
 * across domain switches, gone when it closes. Nothing is saved anywhere else (that needs the source registry).
 */
export interface SourceImport extends CheckedFile {
  readonly id: string;
  /** When it was checked (ISO). */
  readonly importedAt: string;
  /** A fictional file from the example workspace. */
  readonly example: boolean;
}

export interface SourcesView {
  readonly imports: readonly SourceImport[];
  readonly selected: string | null;
}

const VIEW_KEY = 'sources';
const EMPTY: SourcesView = { imports: [], selected: null };

export function sourcesView(state: SocialSessionState): SourcesView {
  return (state.view[VIEW_KEY] as SourcesView | undefined) ?? EMPTY;
}

function update(session: SocialSession, next: (view: SourcesView) => SourcesView): void {
  session.setView(VIEW_KEY, next(sourcesView(session.getState())));
}

let counter = 0;

/** Adds a checked file at the top of the list and selects it. The same bytes checked again replace the earlier entry. */
export function addImport(session: SocialSession, file: CheckedFile, importedAt: string, example: boolean): SourceImport {
  const same = (item: SourceImport) => (file.digest !== null ? item.digest === file.digest : item.name === file.name && item.bytes === file.bytes);
  counter += 1;
  const item: SourceImport = { ...file, id: `import-${counter}`, importedAt, example };
  update(session, (view) => ({ imports: [item, ...view.imports.filter((existing) => !same(existing))], selected: item.id }));
  return item;
}

export function selectImport(session: SocialSession, id: string): void {
  update(session, (view) => ({ ...view, selected: id }));
}

export function removeImport(session: SocialSession, id: string): void {
  update(session, (view) => {
    const imports = view.imports.filter((item) => item.id !== id);
    return { imports, selected: view.selected === id ? imports[0]?.id ?? null : view.selected };
  });
}
