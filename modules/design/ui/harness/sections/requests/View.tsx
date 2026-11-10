import { useState } from 'react';
import type { DesignSectionProps } from '../../../contract.ts';

function read(value: unknown): string {
  return typeof value === 'object' && value !== null && 'text' in value && typeof value.text === 'string' ? value.text : '';
}

/** LABELLED FAKE draft. It has no send path; it only keeps text in the chrome's section state. */
export function FakeDraft({ state }: DesignSectionProps) {
  const [text, setText] = useState(() => read(state.read()));
  return <div className="fake-section" data-fake-section="requests">
    <p className="fake-label">FAKE draft fixture. There is no send action here.</p>
    <label htmlFor="fake-draft">Draft request</label>
    <textarea id="fake-draft" data-testid="draft" rows={6} value={text}
      onChange={(event) => { setText(event.target.value); state.write({ text: event.target.value }); }} />
  </div>;
}
