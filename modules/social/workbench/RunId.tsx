import { useState } from 'react';
import { Button, useToast } from '@hq/ui';
import { SUCCESS_TOAST_MS, copyText } from './ReceiptId';
import './run-id.css';

const COPIED_TOAST = 'social-run-id-copied';

/**
 * A receipt's Run ID as one full-width fact: the whole ID on a single selectable line, and a quiet Copy beside it.
 * It is the receipt's one copy control. Copying only touches the clipboard; when that fails a short note says so and
 * the ID stays selectable.
 */
export function RunIdFact({ id }: { readonly id: string }) {
  const toast = useToast();
  const [failed, setFailed] = useState(false);
  const copy = async () => {
    const copied = await copyText(id);
    setFailed(!copied);
    if (copied) toast.show({ id: COPIED_TOAST, tone: 'success', title: 'Run ID copied', meta: id, duration: SUCCESS_TOAST_MS });
  };
  return (
    <div className="sw-fact-wide">
      <dt>Run ID</dt>
      <dd>
        <code className="sw-run-id">{id}</code>
        <Button size="sm" variant="ghost" onClick={() => void copy()} aria-label="Copy run ID">Copy</Button>
        {failed && <span className="sw-run-id-note" role="status">Couldn't copy it. Select the ID and copy it yourself.</span>}
      </dd>
    </div>
  );
}
