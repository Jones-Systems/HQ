import { useEffect, useId, useRef } from 'react';
import { Button, StatusChip } from '@hq/ui';
import { describeShape } from '../../workbench/imports';
import { longTime } from '../../ui';
import { shortDigest } from './check';
import type { SourceImport } from './store';
import { FitList, type FitListProps } from './FitList';

export const NOT_SAVED = 'Not saved: needs the source registry';

function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes.toLocaleString('en-US')} bytes` : `${(bytes / 1024).toLocaleString('en-US', { maximumFractionDigits: 1 })} KB`;
}

export interface ImportDetailProps extends Omit<FitListProps, 'fits'> {
  readonly item: SourceImport;
  readonly fits: FitListProps['fits'];
  /** Move focus to the heading when a file has just been checked. */
  readonly focusSignal: number;
  readonly onRemove: () => void;
}

/** What the check found in the selected file, and where it can go. It fades in with the result. */
export function ImportDetail({ item, focusSignal, onRemove, ...fitProps }: ImportDetailProps) {
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusSignal > 0) heading.current?.focus();
  }, [focusSignal, item.id]);
  const kind = item.kind === 'jsonl' ? 'JSON Lines' : 'JSON';
  return (
    <article className="sx-panel sd-detail hq-enter-fade" aria-labelledby={`${id}-title`}>
      <header className="sx-panel-head">
        <h2 id={`${id}-title`} tabIndex={-1} ref={heading}>{item.name}</h2>
        <StatusChip tone="success" label="Valid" />
        {item.example && <span className="sx-tag sx-tag--example">Example data</span>}
      </header>
      <p className="sd-valid">
        Valid {kind}{item.records !== null ? ` · ${item.records.toLocaleString('en-US')} ${item.records === 1 ? 'record' : 'records'}` : ''}. Checked on this device; nothing was uploaded or sent.
      </p>
      <dl className="sx-kv">
        <dt>Kind</dt><dd>{kind}</dd>
        <dt>Shape</dt><dd>{describeShape(item.imported.value)}</dd>
        <dt>Size</dt><dd>{formatBytes(item.bytes)}</dd>
        <dt>Data as of</dt><dd>{item.asOf ?? 'Not stated in the file'}</dd>
        <dt>Checked</dt><dd>{longTime(item.importedAt)}</dd>
        <dt>SHA-256</dt><dd className="sx-mono">{item.digest ? shortDigest(item.digest) : 'Not available in this window'}</dd>
        <dt>Origin</dt><dd>{item.example ? 'A fictional example file' : 'Supplied by you · not collected by HQ'}</dd>
        <dt>Saved</dt><dd>{NOT_SAVED}</dd>
        <dt>Used by runs</dt><dd>Not tracked: runs don't record their input file yet.</dd>
      </dl>
      <FitList {...fitProps} />
      <footer className="sd-detail-foot">
        <Button size="sm" variant="ghost" onClick={onRemove}>Remove from this session</Button>
      </footer>
    </article>
  );
}
