import { useMemo } from 'react';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import { designModule as components } from '../../../components/design-module.ts';
import { designModule as discovery } from '../../../discovery/design-module.ts';
import { designModule as flows } from '../../../flows/design-module.ts';
import { designModule as references } from '../../../references/design-module.ts';
import { TasteQueueContext, type TasteQueueValue } from '../../../taste/src/ui/queue-context.ts';
import { tasteQueue } from '../sources/handoff.ts';
import { useHandoffQueue } from '../sources/taste-handoff.ts';
import { TasteView } from './TasteView.tsx';

/** Section titles by id, from the descriptors, so "From References" follows a rename without an edit here. */
const SENDER_TITLES: Readonly<Record<string, string>> = Object.fromEntries(
  [references, components, flows, discovery].map((descriptor) => [descriptor.id, descriptor.title]));

/**
 * Taste with the Sources handoff wired in. The section stays independent: it reads a context it defines itself, and
 * this view fills that context from the composition's queue. Rated and skipped items leave the queue. Everything
 * else is the unchanged Taste view.
 */
export function TasteSourcesView(props: DesignSectionProps) {
  const items = useHandoffQueue(tasteQueue);
  const value = useMemo<TasteQueueValue>(() => ({
    items,
    onRated: (item) => tasteQueue.remove(item.id, item.kind),
    onSkipped: (item) => tasteQueue.remove(item.id, item.kind),
    originLabel: (from) => SENDER_TITLES[from] ?? '',
  }), [items]);
  return <TasteQueueContext value={value}><TasteView {...props} /></TasteQueueContext>;
}
