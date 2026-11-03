import { useEffect, useRef, useState } from 'react';
import { IconButton, useToast } from '@hq/ui';
import { SocialIcon } from '../ui';
import { shortId } from './format';

/** Success toasts stay up for eight seconds, the owner's rule for outcomes. */
export const SUCCESS_TOAST_MS = 8000;

async function copyText(text: string): Promise<boolean> {
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
 * A receipt ID as its short form with a copy button. The short form is the trailing eight characters, which differ
 * between runs even when IDs share a prefix. The full ID is the tooltip and is what the button copies. Copying
 * raises a "Copied" toast; it reads nothing from the service.
 */
export function ReceiptId({ id }: { readonly id: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const reset = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (reset.current) clearTimeout(reset.current); }, []);

  const copy = async () => {
    if (await copyText(id)) {
      toast.success('Copied', { id: `receipt-copy:${id}`, description: 'Receipt ID', meta: id, duration: SUCCESS_TOAST_MS });
      setCopied(true);
      if (reset.current) clearTimeout(reset.current);
      reset.current = setTimeout(() => setCopied(false), 1600);
    } else {
      toast.error("Couldn't copy the receipt ID", { id: `receipt-copy:${id}`, description: 'Select it from this notice instead.', meta: id });
    }
  };

  return (
    <span className="sw-id">
      <code className="sx-mono sw-id-text" title={id}>{shortId(id)}</code>
      <IconButton
        size="sm" label={`Copy receipt ID ${shortId(id)}`} title={`Copy full receipt ID ${id}`}
        icon={<SocialIcon name={copied ? 'check' : 'copy'} />} className={copied ? 'sw-id-copied' : undefined}
        onClick={() => void copy()}
      />
    </span>
  );
}
