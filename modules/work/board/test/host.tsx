import { useRef, useState } from 'react';
import { vi } from 'vitest';
import { STATUS_IDS, useWorkState, type Status, type WorkStore } from '../../core';
import { createDraftStore, DraftsPanel, QuickCapture, useCaptureShortcut, type DraftStore } from '../../capture';
import { CardDetail, createDetailState, type DetailState } from '../../detail';
import type { Feedback } from '../feedback';
import { StatusBoard } from '../StatusBoard';
import { SyncBanners } from '../SyncStatus';
import { useUndoShortcut, WorkToasts } from '../WorkToasts';
import { fixedNow } from './fixtures';

// A minimal Work host for component tests, and synthetic layout for pointer
// tests (happy-dom has no layout).

export interface HostProps {
  store: WorkStore;
  feedback: Feedback;
  drafts?: DraftStore;
  detail?: DetailState;
  initialOpen?: string | null;
}

/** A minimal Work host: board, detail, capture, drafts, banners and toasts, as the domain entry will compose them. */
export function Host({ store, feedback, drafts = createDraftStore(), detail = createDetailState(), initialOpen = null }: HostProps) {
  const state = useWorkState(store, { pollMs: 1e9 });
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<string | null>(initialOpen);
  const [capture, setCapture] = useState<Status | null>(null);
  useUndoShortcut(root, store, feedback);
  useCaptureShortcut(root, () => setCapture('inbox'));
  return (
    <div ref={root} data-testid="work-root">
      <SyncBanners store={store} state={state} />
      <DraftsPanel drafts={drafts} store={store} feedback={feedback} />
      <StatusBoard store={store} state={state} feedback={feedback} now={fixedNow} selectedId={open} onOpenItem={setOpen} onCapture={setCapture} />
      {open && <CardDetail store={store} state={state} feedback={feedback} itemId={open} onClose={() => setOpen(null)} now={fixedNow} detail={detail} />}
      <QuickCapture open={capture !== null} initialStatus={capture ?? 'inbox'} onClose={() => setCapture(null)} store={store} state={state} feedback={feedback} drafts={drafts} now={fixedNow} />
      <WorkToasts store={store} state={state} feedback={feedback} />
    </div>
  );
}

const COLUMN_WIDTH = 300;
const CARD_HEIGHT = 80;

/**
 * Synthetic layout for pointer tests (happy-dom has none): column i spans x ∈ [i·300, i·300+280]; the k-th card in a
 * column spans y ∈ [100+k·80, 170+k·80]. Labelled synthetic; real touch hardware is not exercised.
 */
export function syntheticLayout() {
  return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const rect = (x: number, y: number, width: number, height: number) => ({
      x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON: () => ({}),
    }) as DOMRect;
    const status = this.dataset.dropStatus;
    if (status) return rect(STATUS_IDS.indexOf(status as Status) * COLUMN_WIDTH, 0, 280, 2000);
    const id = this.dataset.cardId;
    if (id) {
      const column = this.closest<HTMLElement>('[data-drop-status]')!;
      const index = [...column.querySelectorAll<HTMLElement>('[data-card-id]')].indexOf(this);
      return rect(STATUS_IDS.indexOf(column.dataset.dropStatus as Status) * COLUMN_WIDTH + 8, 100 + index * CARD_HEIGHT, 264, 70);
    }
    return rect(0, 0, 0, 0);
  });
}

export const columnX = (status: Status) => STATUS_IDS.indexOf(status) * COLUMN_WIDTH + 100;
/** A y just below the midpoint of the card at DOM index `k`, so a drop lands after it; `k = -1` is the column top. */
export const belowCard = (k: number) => (k < 0 ? 60 : 100 + k * CARD_HEIGHT + 50);
