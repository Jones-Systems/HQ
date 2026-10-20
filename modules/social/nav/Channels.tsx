import { useState } from 'react';
import { Button, StatusChip, type StatusTone } from '@hq/ui';
import type { Channel } from '../core';

/** Channels with a platform account behind them; General and Article drafts aren't tied to an account. */
export const ACCOUNT_CHANNELS: readonly Channel[] = ['X', 'LinkedIn', 'TikTok', 'Instagram', 'Facebook', 'Reddit'];

const ROWS: readonly { readonly name: string; readonly tone: StatusTone; readonly label: string }[] = [
  { name: 'Text checks & analysis', tone: 'success', label: 'Available' },
  { name: 'Account connection', tone: 'neutral', label: 'Planned' },
  { name: 'Collection', tone: 'neutral', label: 'Planned' },
  { name: 'Publishing & scheduling', tone: 'neutral', label: 'Planned' },
];

export const PUBLISHING_NEEDS: readonly string[] = [
  'An approved connection for each channel, set up on purpose.',
  'Credentials kept outside the HQ window.',
  'Approval of the exact content of each post, with a receipt.',
  "Reading the platform back, with anything unconfirmed shown as unknown.",
  'Planned dates staying editorial until a post is explicitly approved.',
];

/**
 * Channels & accounts (SOC-8): a static, honest capability page. No control here has an external effect;
 * Connect account is inert and says that nothing changed.
 */
export function Channels({ navigate }: { readonly navigate: (destination: string) => void }) {
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <div className="sd-page">
      <header className="sd-page-head">
        <h1>Channels & accounts</h1>
        <StatusChip tone="neutral" label="Later" />
      </header>
      <p className="sd-note" role="note">
        What HQ can do for each channel today. Nothing on this page connects an account, collects data, posts or schedules.
      </p>
      <p className="sd-status" role="status">{notice}</p>
      <ul className="sd-channels">
        {ACCOUNT_CHANNELS.map((channel) => (
          <li key={channel} className="sd-card">
            <header className="sd-card-head"><h2 id={`sd-channel-${channel}`}>{channel}</h2></header>
            <dl className="sd-capability-list">
              {ROWS.map((row) => (
                <div key={row.name}><dt>{row.name}</dt><dd><StatusChip tone={row.tone} label={row.label} /></dd></div>
              ))}
            </dl>
            <span className="sd-inline">
              <Button
                size="sm" variant="secondary" aria-disabled="true" aria-describedby={`sd-channel-${channel}-why`}
                onClick={() => setNotice(`Nothing changed. Connecting ${channel} accounts isn't available in HQ.`)}
              >
                Connect account…
              </Button>
              <Button size="sm" variant="ghost" onClick={() => navigate('workbenches/social-publisher')}>Check text in Channel preview</Button>
            </span>
            <small id={`sd-channel-${channel}-why`} className="hq-meta">Account connections aren't built; each would need its own approval.</small>
          </li>
        ))}
      </ul>
      <section className="sd-card" aria-labelledby="sd-publishing-needs">
        <header className="sd-card-head"><h2 id="sd-publishing-needs">What publishing would need</h2></header>
        <ul className="sd-list">{PUBLISHING_NEEDS.map((item) => <li key={item}>{item}</li>)}</ul>
      </section>
    </div>
  );
}
