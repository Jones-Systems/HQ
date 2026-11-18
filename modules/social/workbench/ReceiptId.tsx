import { shortId } from './format';

/** Success toasts stay up for eight seconds, the owner's rule for outcomes. */
export const SUCCESS_TOAST_MS = 8000;

/** Copies text to the clipboard, or by selection where the clipboard is unavailable; true only when one reports success. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the selection copy */ }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.className = 'hq-sr-only';
    document.body.append(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  } catch {
    return false;
  }
}

/**
 * A receipt ID in its short form: the trailing eight characters, which differ between runs even when IDs share a
 * prefix. The full ID is the tooltip; the receipt's Run ID row shows it whole and is where it is copied from.
 */
export function ReceiptId({ id }: { readonly id: string }) {
  return <code className="sx-mono sw-id-text" title={id}>{shortId(id)}</code>;
}
