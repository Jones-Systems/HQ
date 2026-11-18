import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

for (const entry of ['index.html', 'empty.html']) {
  it(`${entry} explicitly blocks workers while preserving sealed static resource policy`, () => {
    const html = readFileSync(new URL(`../../preview/${entry}`, import.meta.url), 'utf8');
    const policies = [...html.matchAll(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"\s*\/?\s*>/g)];
    expect(policies).toHaveLength(1);
    const directives = policies[0]![1]!.split(';').map(value => value.trim().split(/\s+/));
    expect(directives.filter(([name]) => name === 'worker-src')).toEqual([['worker-src', "'none'"]]);
    expect(directives.filter(([name]) => name !== 'worker-src')).toEqual([
      ['default-src', "'none'"],
      ['script-src', "'self'"],
      ['style-src', "'self'"],
      ['img-src', "'self'", 'data:'],
      ['font-src', "'self'"],
      ['connect-src', "'none'"],
      ['object-src', "'none'"],
      ['base-uri', "'none'"],
      ['form-action', "'none'"],
      ['frame-src', "'none'"],
    ]);
  });
}
