import { useId, useState } from 'react';
import { Button, StatusChip, type StatusTone } from '@hq/ui';
import type { Channel } from '../core';
import { ChannelBadge, PageHeader, SocialIcon } from '../ui';
import './pages.css';

/** Channels with a platform account behind them; General and Article drafts aren't tied to an account. */
export const ACCOUNT_CHANNELS: readonly Channel[] = ['X', 'LinkedIn', 'TikTok', 'Instagram', 'Facebook', 'Reddit'];

interface Capability {
  readonly name: string;
  readonly tone: StatusTone;
  readonly label: 'Available' | 'Planned';
}

/** The same four capabilities for every channel: only text checks and analysis exist today. */
const CAPABILITIES: readonly Capability[] = [
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

/** Where each channel's available capability lives: the Channel preview checks five text profiles; Reddit is analysis of a corpus. */
function checkTool(channel: Channel): { readonly tool: string; readonly name: string } {
  return channel === 'Reddit' ? { tool: 'reddit-opportunities', name: 'Reddit opportunities' } : { tool: 'social-publisher', name: 'Channel preview' };
}

/**
 * Channels & accounts (SOC-8): one honest capability matrix, channels by capability. No control here has an external
 * effect; *Connect account…* is inert and says that nothing changed.
 */
export function Channels({ navigate }: { readonly navigate: (destination: string) => void }) {
  const id = useId();
  const [notice, setNotice] = useState<{ readonly text: string; readonly count: number } | null>(null);
  const whyId = `${id}-why`;
  return (
    <div className="sx-page sd-channels">
      <PageHeader
        title="Channels & accounts" description="What HQ Social can and can't do with each platform today."
        actions={<StatusChip tone="neutral" label="Later" />}
      />

      <section className="sx-panel sx-panel--sunken sd-why hq-enter-fade" id={whyId} aria-labelledby={`${id}-why-title`}>
        <h2 id={`${id}-why-title`} className="sd-subhead">Why accounts can't be linked yet</h2>
        <p>
          HQ can't link an account today, and it can't post anything. Account connection, collection and publishing are planned, but each needs
          its own approval: what HQ may access, where credentials are kept, and a confirmation step for every post. Nothing on this page changes any account.
        </p>
      </section>

      <div className="sx-table-wrap sd-matrix-wrap hq-enter-rise">
        <table className="sx-table sd-matrix">
          <caption className="hq-sr-only">What HQ Social can do for each channel today</caption>
          <thead>
            <tr>
              <th scope="col">Channel</th>
              {CAPABILITIES.map((capability) => <th key={capability.name} scope="col">{capability.name}</th>)}
              <th scope="col"><span className="hq-sr-only">Connect</span></th>
            </tr>
          </thead>
          <tbody>
            {ACCOUNT_CHANNELS.map((channel) => {
              const where = checkTool(channel);
              return (
                <tr key={channel}>
                  <th scope="row" className="sd-matrix-channel">
                    <span className="sd-channel-cell"><ChannelBadge channel={channel} /><span aria-hidden="true">{channel}</span></span>
                  </th>
                  {CAPABILITIES.map((capability, index) => (
                    <td key={capability.name}>
                      <StatusChip tone={capability.tone} label={capability.label} />
                      {index === 0 && (
                        <Button
                          size="sm" variant="ghost" className="sd-matrix-link" aria-label={`Check ${channel} text in ${where.name}`}
                          onClick={() => navigate(`workbenches/${where.tool}`)}
                        >
                          {where.name}<SocialIcon name="arrow-right" />
                        </Button>
                      )}
                    </td>
                  ))}
                  <td className="sd-matrix-action">
                    <Button
                      size="sm" variant="secondary" aria-disabled="true" aria-describedby={whyId}
                      onClick={() => setNotice({ text: `Nothing changed. Connecting ${channel} accounts isn't available in HQ.`, count: (notice?.count ?? 0) + 1 })}
                    >
                      Connect account…
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="sd-status" role="status">{notice && <span key={notice.count} className="hq-enter-fade">{notice.text}</span>}</p>

      <section className="sx-panel" aria-labelledby={`${id}-needs`}>
        <header className="sx-panel-head"><h2 id={`${id}-needs`}>What publishing would need</h2></header>
        <ol className="sd-needs">{PUBLISHING_NEEDS.map((item) => <li key={item}>{item}</li>)}</ol>
      </section>
    </div>
  );
}
