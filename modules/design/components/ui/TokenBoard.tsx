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
  if (token.type === 'color') return <span className="hqc-sample hqc-swatch" style={{ backgroundColor: value }} aria-hidden="true" />;
  if (token.type === 'dimension') return <span className="hqc-sample hqc-bar" style={{ width: value }} aria-hidden="true" />;
  if (token.type === 'shadow') return <span className="hqc-sample hqc-shadow" style={{ boxShadow: value }} aria-hidden="true" />;
  if (token.type === 'fontFamily') return <span className="hqc-sample hqc-type" style={{ fontFamily: value }} aria-hidden="true">Aa</span>;
  if (token.type === 'fontWeight') return <span className="hqc-sample hqc-type" style={{ fontWeight: Number(value) }} aria-hidden="true">Aa</span>;
  return <span className="hqc-sample" aria-hidden="true" />;
}

export function TokenBoard({ system }: { readonly system: DesignSystem }) {
  const { values, problems } = resolveTokens(system);
  return <section className="hqc-tokens" aria-label={`${system.name} tokens`}>
    <h2>{system.name}</h2>
    {problems.length === 0 ? null : <ul className="hqc-problems" aria-label="Token problems">
      {problems.map((problem, index) => <li key={index}>{problemText(problem)}</li>)}
    </ul>}
    {groupTokens(system).map((group) => <section key={group.id} className="hqc-token-group" aria-labelledby={`hqc-group-${group.id}`}>
      <h3 id={`hqc-group-${group.id}`}>{group.name}</h3>
      {group.componentIds.length === 0 ? null : <p className="hqc-note">Used by {group.componentIds.join(', ')}</p>}
      {group.byType.map((bucket) => <table key={bucket.type} className="hqc-token-table">
        <caption>{bucket.type}</caption>
        <thead><tr><th scope="col">Token</th><th scope="col">Value</th><th scope="col">Sample</th></tr></thead>
        <tbody>
          {bucket.tokens.map((token) => <tr key={token.id}>
            <th scope="row" className="hqc-mono">{token.id}</th>
            <td className="hqc-mono">
              {values[token.id] ?? 'unresolved'}
              {token.value.startsWith('{') ? <span className="hqc-alias"> via {token.value}</span> : null}
            </td>
            <td><Sample token={token} value={values[token.id]} /></td>
          </tr>)}
        </tbody>
      </table>)}
    </section>)}
  </section>;
}
