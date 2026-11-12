import { useEffect, type RefObject } from 'react';
import { isTyping } from '../views/env';
import { numberKeyDestination } from './routes';

/**
 * The destination a keydown opens through the Work number keys (1–7, from `WORK_VIEWS`), or null when the key is not
 * theirs. They stay out of the way of typing (an input, a select, a text area, an editable region), of any modified
 * key, of a key repeat, of a key inside a modal dialog and of an event another handler already took.
 */
export function numberKeyTarget(event: KeyboardEvent): string | null {
  if (event.defaultPrevented || event.repeat || event.isComposing) return null;
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
  if (event.key.length !== 1 || event.key < '1' || event.key > '9') return null;
  if (isTyping(event.target)) return null;
  if (event.target instanceof Element && event.target.closest('[role="dialog"][aria-modal="true"]')) return null;
  return numberKeyDestination(event.key);
}

/**
 * 1–7 open the Work views while focus is inside the Work surface `root`, like the Planner's number keys. Navigation
 * only: it never writes, and it never fires from another domain.
 */
export function useNumberKeys(root: RefObject<HTMLElement | null>, open: (destination: string) => void): void {
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const destination = numberKeyTarget(event);
      if (destination === null) return;
      event.preventDefault();
      open(destination);
    };
    element.addEventListener('keydown', onKeyDown);
    return () => element.removeEventListener('keydown', onKeyDown);
  }, [root, open]);
}
