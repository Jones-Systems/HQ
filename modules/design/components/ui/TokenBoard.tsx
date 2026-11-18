import { InlineNotice, useToast } from '@hq/ui';
import type { DesignSystem, DesignToken } from '../src/contract.ts';
import { groupTokens, resolveTokens } from '../src/model/tokens.ts';
import type { TokenProblem } from '../src/model/tokens.ts';

function problemText(problem: TokenProblem): string {
  switch (problem.kind) {
    case 'missing-alias': return `${problem.tokenId} aliases missing token ${problem.target}`;
    case 'alias-cycle': return `Alias cycle: ${problem.path.join(' → ')}`;
    case 'alias-type': return `${problem.tokenId} aliases ${problem.target} of another type`;
    case 'alias-unresolved': return `${problem.tokenId} depends on an unresolved alias`;
  }
}

/** Token values render with their own colors, independent of HQ appearance. */
function Sample({ token, value }: { readonly token: DesignToken; readonly value: string | undefined }) {
  if (value === undefined) return <span className="hqc-sample hqc-sample-missing" aria-hidden="true">?</span>;
  if (token.type === 'color') return <span className="hqc-sample hqc-swatch hqc-swatch-lg" style={{ backgroundColor: value }} aria-hidden="true" />;
  if (token.type === 'dimension') return <span className="hqc-sample hqc-bar" style={{ width: value }} aria-hidden="true" />;
  if (token.type === 'shadow') return <span className="hqc-sample hqc-shadow" style={{ boxShadow: value }} aria-hidden="true" />;
  if (token.type === 'fontFamily') return <span className="hqc-sample hqc-type" style={{ fontFamily: value }} aria-hidden="true">Aa</span>;
  if (token.type === 'fontWeight') return <span className="hqc-sample hqc-type" style={{ fontWeight: Number(value) }} aria-hidden="true">Aa</span>;
  return <span className="hqc-sample hqc-type hqc-mono" aria-hidden="true">{value}</span>;
}

/** Swatch grid by design-system group and type. A token is a button: it copies its id. */
export function TokenBoard({ system, copyTokenId }: { readonly system: DesignSystem; readonly copyTokenId?: (id: string) => Promise<void> }) {
  const { values, problems } = resolveTokens(system);
  const toast = useToast();
  const copy = async (token: DesignToken) => {
    const value = values[token.id] ?? 'unresolved';
    const showValue = () => toast.info(`${token.id} · ${value}`, { id: 'hqc-token-copy', description: 'Copying is not available here, so this is the value.' });
    if (copyTokenId === undefined) { showValue(); return; }
    try {
      await copyTokenId(token.id);
      toast.success(`Copied ${token.id}`, { id: 'hqc-token-copy', meta: value });
    } catch {
      showValue();
    }
  };
  return <section className="hqc-tokens" aria-label={`${system.name} tokens`}>
    <h2>{system.name}</h2>
    {problems.length === 0 ? null : <InlineNotice tone="warning" live="off" title={problems.length === 1 ? '1 token problem' : `${problems.length} token problems`}>
      <ul className="hqc-problems" aria-label="Token problems">
        {problems.map((problem, index) => <li key={index}>{problemText(problem)}</li>)}
      </ul>
    </InlineNotice>}
    {groupTokens(system).map((group) => <section key={group.id} className="hqc-token-group" aria-labelledby={`hqc-group-${group.id}`}>
      <h3 id={`hqc-group-${group.id}`}>{group.name}</h3>
      {group.componentIds.length === 0 ? null : <p className="hqc-note">Used by {group.componentIds.join(', ')}</p>}
      {group.byType.map((bucket) => <div key={bucket.type} className="hqc-token-bucket">
        {group.byType.length === 1 && bucket.type === group.name.toLowerCase() ? null : <h4 className="hqc-eyebrow">{bucket.type}</h4>}
        <ul className="hqc-token-grid">
          {bucket.tokens.map((token) => <li key={token.id}>
            <button type="button" className="hqc-token hq-press hq-lift" aria-label={`Copy ${token.id}, ${values[token.id] ?? 'unresolved'}`}
              title="Copy the token id" onClick={() => void copy(token)}>
              <span className="hqc-token-sample"><Sample token={token} value={values[token.id]} /></span>
              <span className="hqc-token-id hqc-mono">{token.id}</span>
              <span className="hqc-token-value hqc-mono">
                {values[token.id] ?? 'unresolved'}
                {token.value.startsWith('{') ? <span className="hqc-alias"> via {token.value}</span> : null}
              </span>
            </button>
          </li>)}
        </ul>
      </div>)}
    </section>)}
  </section>;
}
