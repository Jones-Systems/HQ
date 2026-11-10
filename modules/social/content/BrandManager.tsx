import { useId, useState, type FormEvent } from 'react';
import { Button, StatusChip } from '@hq/ui';
import { DEFAULT_BRAND_ID, LIMITS, checkBrandName, codePoints, portErrorOf, type SocialSession, type SocialWorkspacePort, type WorkspaceSnapshot } from '../core';
import { errorText } from './actions';

export interface BrandManagerProps {
  readonly session: SocialSession;
  readonly port: SocialWorkspacePort;
  readonly snapshot: WorkspaceSnapshot;
  readonly paused?: string;
}

/**
 * Lists brands and adds one (RC-3). The built-in brand is shown as present, never created.
 * Adding is one `addBrand` call followed by one workspace read to show the stored list.
 */
export function BrandManager({ session, port, snapshot, paused }: BrandManagerProps) {
  const id = useId();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || paused) return;
    setStatus(null);
    const checked = checkBrandName(name);
    if (!checked.ok) {
      setError(checked.error.message);
      return;
    }
    setBusy(true);
    try {
      const brand = await port.addBrand(checked.value);
      setError(null);
      setName('');
      setStatus(`Added ${brand.name}.`);
      await session.load(port);
    } catch (reason) {
      const portError = portErrorOf(reason);
      setError(portError ? errorText(portError) : 'The brand could not be added.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="soc-brands" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>Brands</h2>
      <ul className="soc-rows" aria-label="Brands">
        {snapshot.brands.map((brand) => (
          <li key={brand.id} className="soc-row">
            <span className="soc-row-main"><strong>{brand.name}</strong></span>
            {brand.id === DEFAULT_BRAND_ID && <StatusChip tone="neutral" label="Built in" />}
          </li>
        ))}
      </ul>
      <form className="soc-inline" onSubmit={(event) => void submit(event)} noValidate>
        <div className="soc-field">
          <label htmlFor={`${id}-name`}>New brand name</label>
          <input
            id={`${id}-name`} value={name} onChange={(event) => setName(event.target.value)} disabled={busy}
            aria-invalid={error ? true : undefined} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
          />
          <small id={`${id}-hint`} className="hq-meta">{codePoints(name)} / {LIMITS.brandName} characters</small>
        </div>
        <Button type="submit" variant="secondary" size="sm" busy={busy} busyLabel="Adding…" disabled={Boolean(paused)}>Add brand</Button>
      </form>
      {error && <p id={`${id}-error`} className="soc-note soc-note--danger" role="alert">{error}</p>}
      {status && <p className="soc-note" role="status">{status}</p>}
    </section>
  );
}
