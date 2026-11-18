import { useEffect, useImperativeHandle, useRef, useState, type PointerEvent, type Ref } from 'react';
import { PreservedContent, animateElement, useReducedMotion } from '@hq/ui';
import {
  choiceText, deckKindWord, dragIntent, dragRotation, exitOffset,
  type DeckChoice, type DeckDirection, type DragIntent,
} from './deck-model.ts';
import type { TasteQueueItem } from './queue-context.ts';

/** What the deck can ask of the card in front. */
export interface DeckCardHandle {
  /** Throws the card off in a direction. Resolves when it has gone; at once under reduced motion. */
  readonly flyOff: (direction: DeckDirection) => Promise<void>;
  /** Springs the card back to rest after a drag that was not kept. */
  readonly snapBack: () => void;
}

export interface DeckCardProps {
  readonly item: TasteQueueItem;
  readonly position: 'front' | 'peek';
  readonly origin: string;
  /** Already vetted by `deckImageUrl`; null shows the kind glyph instead. */
  readonly imageUrl: string | null;
  /** A choice that has been made and is being saved: shown as the stamp at full strength. */
  readonly committed: DeckChoice | null;
  readonly state: 'idle' | 'saving' | 'unknown';
  readonly dragEnabled: boolean;
  /** A drag released past the threshold. The deck decides what happens next. */
  readonly onRelease: (choice: DeckChoice) => void;
  readonly ref?: Ref<DeckCardHandle>;
}

const REST = 'translate(0px, 0px) rotate(0deg)';
const transformFor = (dx: number, dy: number, turn: number) => `translate(${dx}px, ${dy}px) rotate(${turn}deg)`;
const NO_INTENT: DragIntent = { choice: null, progress: 0, armed: false };

/**
 * One card of the deck. The card (the frame) moves; the image inside it is never faded, filtered or recoloured,
 * and sits in a preserved-content well. The peeking card behind it is only a frame until it takes the front.
 */
export function DeckCard({ item, position, origin, imageUrl, committed, state, dragEnabled, onRelease, ref }: DeckCardProps) {
  const reduced = useReducedMotion();
  const cardRef = useRef<HTMLDivElement>(null);
  const offset = useRef({ dx: 0, dy: 0 });
  const drag = useRef<{ pointer: number; x: number; y: number } | null>(null);
  const [intent, setIntent] = useState<DragIntent>(NO_INTENT);
  const [broken, setBroken] = useState(false);

  const place = (dx: number, dy: number) => {
    const el = cardRef.current;
    offset.current = { dx, dy };
    if (!el) return;
    el.style.transform = dx === 0 && dy === 0 ? '' : transformFor(dx, dy, reduced ? 0 : dragRotation(dx));
  };

  const snapBack = () => {
    const el = cardRef.current;
    if (!el) return;
    const { dx, dy } = offset.current;
    const from = transformFor(dx, dy, reduced ? 0 : dragRotation(dx));
    place(0, 0);
    setIntent(NO_INTENT);
    animateElement(el, [{ transform: from }, { transform: REST }], { duration: 'base', easing: 'spring' });
  };

  const flyOff = async (direction: DeckDirection) => {
    const el = cardRef.current;
    if (!el) return;
    const from = offset.current;
    const end = exitOffset(direction, from);
    const turn = direction === 'left' ? -12 : direction === 'right' ? 12 : 0;
    const finish = transformFor(end.dx, end.dy, turn);
    el.dataset.leaving = 'true';
    const animation = animateElement(el, [{ transform: transformFor(from.dx, from.dy, dragRotation(from.dx)) }, { transform: finish }],
      { duration: 'slow', easing: 'exit' });
    if (!animation) return;
    // The animation does not fill, so the card is left where it ends and stays gone until the deck unmounts it.
    el.style.transform = finish;
    await animation.finished.catch(() => undefined);
  };

  useImperativeHandle(ref, () => ({ flyOff, snapBack }));

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const el = cardRef.current;
    if (!dragEnabled || position !== 'front' || state !== 'idle' || event.button !== 0 || !el) return;
    el.setPointerCapture(event.pointerId);
    el.dataset.dragging = 'true';
    drag.current = { pointer: event.pointerId, x: event.clientX - offset.current.dx, y: event.clientY - offset.current.dy };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start || start.pointer !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    place(dx, dy);
    const next = dragIntent(dx, dy);
    setIntent((last) => (last.choice === next.choice && Math.abs(last.progress - next.progress) < 0.05 && last.armed === next.armed ? last : next));
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const start = drag.current;
    const el = cardRef.current;
    if (!start || start.pointer !== event.pointerId || !el) return;
    drag.current = null;
    delete el.dataset.dragging;
    if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
    const released = dragIntent(offset.current.dx, offset.current.dy);
    if (!cancelled && released.armed && released.choice) onRelease(released.choice);
    else snapBack();
  };

  const stamp = committed ?? intent.choice;
  const strength = committed ? 1 : intent.progress;
  const side = stamp?.kind === 'rate' ? (stamp.value >= 5 ? 'up' : stamp.value >= 4 ? 'right' : stamp.value <= 2 ? 'left' : 'down') : null;
  const showImage = imageUrl !== null && !broken;
  // The stamp's strength is a custom property, so the stylesheet owns how it ramps.
  useEffect(() => { cardRef.current?.style.setProperty('--taste-strength', String(strength)); }, [strength]);

  return <div ref={cardRef} className="taste-deck-card" data-position={position} data-state={state} data-armed={intent.armed || undefined}
    aria-hidden={position === 'peek' || undefined} inert={position === 'peek' || undefined}
    onPointerDown={onPointerDown} onPointerMove={onPointerMove}
    onPointerUp={(event) => finishDrag(event, false)} onPointerCancel={(event) => finishDrag(event, true)}>
    {showImage
      ? <PreservedContent kind="captured" recordedScheme="light" className="taste-deck-image">
        <img src={imageUrl} alt={`Preview of ${item.label}`} draggable={false} onError={() => setBroken(true)} />
      </PreservedContent>
      : <div className="taste-deck-glyph" aria-hidden="true"><KindGlyph kind={item.kind} /></div>}
    <div className="taste-deck-info">
      <strong className="taste-deck-label">{item.label}</strong>
      {item.detail && <span className="taste-deck-detail">{item.detail}</span>}
      <span className="taste-deck-meta">
        <span className="taste-tag">{deckKindWord(item.kind)}</span>
        <span className="taste-deck-origin">From {origin}</span>
      </span>
    </div>
    {stamp && side && <span className="taste-deck-stamp" data-side={side} data-armed={(strength >= 1) || undefined}
      aria-hidden="true">{choiceText(stamp)}</span>}
  </div>;
}

function KindGlyph({ kind }: { readonly kind: TasteQueueItem['kind'] }) {
  switch (kind) {
    case 'reference': return <svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5" /></svg>;
    case 'component': return <svg viewBox="0 0 24 24"><path d="m12 3.5 7.5 4.2v8.6L12 20.5l-7.5-4.2V7.7Z" /><path d="m4.8 7.9 7.2 4.1 7.2-4.1M12 12v8.2" /></svg>;
    case 'flow': return <svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="6" height="5" rx="1.2" /><rect x="14.5" y="14.5" width="6" height="5" rx="1.2" /><path d="M9.5 7h3a2 2 0 0 1 2 2v5.5" /></svg>;
    case 'other': return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5" /><circle cx="12" cy="12" r="1.2" /></svg>;
  }
}
