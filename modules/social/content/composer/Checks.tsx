import { SocialIcon, type SocialIconName } from '../../ui';
import type { CheckState, DraftCheck } from './channel';

const ICONS: { readonly [S in CheckState]: SocialIconName } = { pass: 'check', warn: 'alert', fail: 'close', info: 'info' };
const WORDS: { readonly [S in CheckState]: string } = { pass: 'Passed', warn: 'Heads up', fail: 'Needs fixing', info: 'Note' };

/** The draft's checks, each with a shape and a word as well as a colour. Advice only: none of them posts anything. */
export function Checks({ checks, headingId }: { readonly checks: readonly DraftCheck[]; readonly headingId: string }) {
  return (
    <div className="soc-checks" role="group" aria-labelledby={headingId}>
      <h3 id={headingId}>Checks</h3>
      <ul>
        {checks.map((check) => (
          <li key={check.id} data-state={check.state}>
            <span className="soc-check-mark" aria-hidden="true"><SocialIcon name={ICONS[check.state]} /></span>
            <span><span className="hq-sr-only">{WORDS[check.state]}: </span>{check.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
