import { stripDerived, type Item, type ItemPatch, type PatchField, type PlanningDate, type WorkStore, type WriteOutcome } from '../core';
import { reportWrite } from '../board/actions';
import type { Feedback } from '../board/feedback';
import type { DetailState, TextField } from './detail-state';

// Detail edits (RV-3). Every edit is a store.patch at the item's confirmed
// revision. A conflict is resolved the Planner's way: if the Planner's value of
// each edited field is still what the edit started from, the edit is re-applied
// automatically; otherwise the user chooses Keep mine or Use theirs, and their
// text is never discarded silently.

/** The Planner's notes debounce: autosave this long after typing stops. */
export const NOTES_DEBOUNCE_MS = 1_200;

const FIELD_WORD: Record<PatchField, string> = {
  title: 'title', kind: 'kind', motivation: 'why', horizon: 'horizon', priority: 'priority', area: 'area',
  notes: 'notes', next_steps: 'checklist', references: 'links', dates: 'dates',
};

export function fieldWords(fields: readonly PatchField[]): string {
  const words = fields.map((field) => FIELD_WORD[field]);
  return words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

/** A field's write form, for comparison: dates lose their derived read-only members. */
export function writableValue(field: PatchField, value: unknown): unknown {
  return field === 'dates' && Array.isArray(value) ? (value as PlanningDate[]).map(stripDerived) : value;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])]));
  }
  return value;
}

export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

export interface SaveOptions {
  /** Toast text on success, with Undo. Omitted for autosaved notes, whose undo stays on Ctrl/⌘+Z. */
  toast?: string;
  /** The values this edit started from; defaults to the confirmed item's values now. */
  base?: Partial<Record<PatchField, unknown>>;
}

export type Editor = ReturnType<typeof createEditor>;

export function createEditor(store: WorkStore, feedback: Feedback, detail: DetailState, itemId: string) {
  const confirmed = (): Item | undefined => store.getState().confirmed?.items.find((item) => item.id === itemId);

  /** Fields whose Planner value no longer equals the edit's starting value. */
  function changedSince(current: Item, base: Partial<Record<PatchField, unknown>>): PatchField[] {
    return (Object.keys(base) as PatchField[]).filter((field) => !sameValue(writableValue(field, current[field]), writableValue(field, base[field])));
  }

  async function save(patch: ItemPatch, options: SaveOptions = {}): Promise<WriteOutcome> {
    const item = confirmed();
    const fields = Object.keys(patch) as PatchField[];
    const base = options.base ?? Object.fromEntries(fields.map((field) => [field, item ? writableValue(field, item[field]) : undefined]));
    // A picker or asynchronous read may outlive a refresh. Compare its rendered base before writing.
    if (item && options.base) {
      const changed = changedSince(item, base);
      if (changed.length) {
        detail.setConflict(itemId, { fields: changed, mine: patch,
          theirs: Object.fromEntries(changed.map((field) => [field, item[field]])) });
        return { status: 'failed', error: { kind: 'revision_conflict', current: item } };
      }
    }
    const outcome = await store.patch(itemId, patch);
    if (outcome.status === 'failed' && outcome.error.kind === 'revision_conflict') {
      const changed = changedSince(outcome.error.current, base);
      store.dismissConflict(itemId);
      if (changed.length === 0) {
        // A different field changed elsewhere: re-apply this edit at the current revision, as the Planner does.
        const retried = await store.patch(itemId, patch);
        if (options.toast) reportWrite(feedback, retried, options.toast);
        return retried;
      }
      detail.setConflict(itemId, {
        fields: changed,
        mine: patch,
        theirs: Object.fromEntries(changed.map((field) => [field, outcome.error.kind === 'revision_conflict' ? outcome.error.current[field] : undefined])),
      });
      return outcome;
    }
    if (options.toast || outcome.status !== 'saved') reportWrite(feedback, outcome, options.toast ?? '');
    return outcome;
  }

  /**
   * Sends a text buffer if it differs from the Planner. If the Planner's value moved since editing began, nothing
   * is sent and the conflict is shown instead, so another device's text is never overwritten silently.
   */
  async function flushText(field: TextField): Promise<WriteOutcome | null> {
    const buffer = detail.buffer(itemId, field);
    const item = confirmed();
    if (!buffer || !item) return null;
    const server = (item[field] ?? '') as string;
    if (buffer.text === server) {
      detail.clearBuffer(itemId, field);
      return null;
    }
    if (server !== buffer.base) {
      detail.setConflict(itemId, { fields: [field], mine: { [field]: buffer.text }, theirs: { [field]: item[field] } });
      return null;
    }
    const sent = buffer.text;
    const value = field === 'area' ? (sent.trim() ? sent : null) : sent;
    const outcome = await save({ [field]: value }, { base: { [field]: buffer.base }, toast: field === 'notes' ? undefined : `Saved ${FIELD_WORD[field]}` });
    if (outcome.status === 'saved') {
      const now = detail.buffer(itemId, field);
      if (now?.text === sent) detail.clearBuffer(itemId, field);
      else if (now) detail.setBuffer(itemId, field, { text: now.text, base: (confirmed()?.[field] ?? '') as string });
    }
    return outcome;
  }

  return {
    save,
    flushText,
    /** Keep mine: re-send the user's change at the Planner's current revision. */
    async keepMine(): Promise<WriteOutcome | null> {
      const conflict = detail.conflict(itemId);
      if (!conflict) return null;
      detail.clearConflict(itemId);
      for (const field of conflict.fields) if (field === 'title' || field === 'area' || field === 'notes') detail.clearBuffer(itemId, field);
      return save(conflict.mine, { toast: `Kept your ${fieldWords(conflict.fields)}` });
    },
    /** Use theirs: drop the user's unsent change for those fields and show the Planner's value. Nothing is sent. */
    useTheirs(): void {
      const conflict = detail.conflict(itemId);
      if (!conflict) return;
      detail.clearConflict(itemId);
      for (const field of conflict.fields) if (field === 'title' || field === 'area' || field === 'notes') detail.clearBuffer(itemId, field);
    },
  };
}
