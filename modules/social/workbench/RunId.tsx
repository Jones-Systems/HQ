import { useState } from 'react';
import { Button, useToast } from '@hq/ui';
import './run-id.css';

const COPIED_TOAST = 'social-run-id-copied';

/**
 * A receipt's Run ID as one full-width fact: the whole ID on a single selectable line, and a quiet Copy beside it.
 * Copying only touches the clipboard. When the clipboard is not available a short note says so; the ID stays selectable.
 */
export function RunIdFact({ id }: { readonly id: string }) {
  const toast = useToast();
  const [failed, setFailed] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setFailed(false);
      toast.show({ id: COPIED_TOAST, tone: 'success', title: 'Run ID copied' });
    } catch {
      setFailed(true);
    }
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
