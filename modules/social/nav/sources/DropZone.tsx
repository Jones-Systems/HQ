import { useId, useRef, useState, type DragEvent } from 'react';
import { Button } from '@hq/ui';
import { SocialIcon } from '../../ui';

export interface DropZoneProps {
  /** A check is running. */
  readonly busy: boolean;
  readonly onFiles: (files: readonly File[]) => void;
  /** Fictional files, offered in the example workspace only. */
  readonly examples?: { readonly onValid: () => void; readonly onBroken: () => void };
}

function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

/** Where a file is dropped or chosen. The drop zone reacts while a file is dragged over it. */
export function DropZone({ busy, onFiles, examples }: DropZoneProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <section
      className="sd-drop" aria-labelledby={`${id}-title`} data-dragging={dragging ? '' : undefined} aria-busy={busy || undefined}
      onDragEnter={(event) => { if (carriesFiles(event)) { event.preventDefault(); setDragging(true); } }}
      onDragOver={(event) => { if (carriesFiles(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const files = [...event.dataTransfer.files];
        if (files.length) onFiles(files);
      }}
    >
      <span className="sd-drop-icon" aria-hidden="true"><SocialIcon name="upload" /></span>
      <div className="sd-drop-text">
        <h2 id={`${id}-title`}>Drop a file to check it</h2>
        <p>{dragging ? 'Release to check it here.' : 'JSON or JSON Lines, up to 2 MB. It is read on this device; nothing is uploaded or sent.'}</p>
      </div>
      <div className="sd-drop-actions">
        <Button variant="primary" busy={busy} busyLabel="Checking" onClick={() => input.current?.click()}>
          <SocialIcon name="file" />Choose file…
        </Button>
        {examples && (
          <>
            <Button size="sm" variant="ghost" disabled={busy} onClick={examples.onValid}>Use fictional example</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={examples.onBroken}>Try a broken file</Button>
          </>
        )}
      </div>
      <input
        ref={input} className="sd-file" type="file" multiple tabIndex={-1} aria-label="Choose JSON or JSON Lines files to check"
        accept=".json,.jsonl,.ndjson,application/json"
        onChange={(event) => {
          const target = event.currentTarget;
          const files = [...(target.files ?? [])];
          target.value = '';
          if (files.length) onFiles(files);
        }}
      />
    </section>
  );
}
