import { useSyncExternalStore } from 'react';
import type { ToastApi } from '@hq/ui';
import type { DesignLocation } from '../../../ui/contract.ts';
import { designModule as tasteModule } from '../../../taste/design-module.ts';
import { tasteQueue, type HandoffQueue, type HandoffSubject } from './handoff.ts';

/** Where Taste is mounted; follows its descriptor, so a placement change needs no edit here. */
export const TASTE_LOCATION: DesignLocation = { nav: tasteModule.nav, section: tasteModule.id };

export function useHandoffQueue(queue: HandoffQueue = tasteQueue): readonly HandoffSubject[] {
  return useSyncExternalStore(queue.subscribe, queue.snapshot, queue.snapshot);
}

/** Queues an item for Taste and confirms with one updating toast that can open Taste. Nothing is rated yet. */
export function sendToTaste(subject: HandoffSubject, navigate: (location: DesignLocation) => void, toast: ToastApi,
  queue: HandoffQueue = tasteQueue): ReturnType<HandoffQueue['add']> {
  const result = queue.add(subject);
  const waiting = queue.snapshot().length;
  toast.show({
    id: 'design-sources-taste-queue',
    tone: result === 'full' ? 'warning' : 'success',
    title: result === 'added' ? `“${subject.label}” is ready to rate`
      : result === 'already-queued' ? `“${subject.label}” is already waiting in Taste` : 'The Taste queue is full',
    meta: result === 'full' ? 'Rate or skip some items first' : `${waiting} waiting in Taste`,
    action: { label: 'Open Taste', onAction: () => navigate(TASTE_LOCATION) },
  });
  return result;
}
