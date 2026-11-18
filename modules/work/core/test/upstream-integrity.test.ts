import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// D-1 integrity: the upstream copies must stay byte-identical to the approved
// source blobs. Any edit, line-ending change or re-encoding fails here.

const UPSTREAM = new URL('../upstream/manual-planner/', import.meta.url);
const APPROVED = [
  { file: 'ordering.js', blob: '0415a2103a33f79679284e19c09fbf5a911ae5a5', sha256: 'abf141543f18fcbaefe8abae92a3f35c295d4a093ab73c8eabe30da7d57d868b', bytes: 2759 },
  { file: 'dates.js', blob: '8932be4def432eec59b60427741a08ee4fe66db7', sha256: '390c39e8fda9c539a388cfac4675eca97356893e27dd36ae4f589767c954b903', bytes: 12752 },
  { file: 'model.js', blob: '926a54e980b384901e50bcd7a20c488fca01ba2a', sha256: 'fb24638a1a68b85c5f2185668c1335ec0403ee219cba75075f22fb1896041f80', bytes: 6575 },
] as const;

describe('Manual Planner upstream copies (D-1)', () => {
  it.each(APPROVED)('$file matches its approved bytes', ({ file, blob, sha256, bytes }) => {
    const content = readFileSync(new URL(file, UPSTREAM));
    expect(content.length).toBe(bytes);
    expect(createHash('sha256').update(content).digest('hex')).toBe(sha256);
    const gitBlob = createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${content.length}\0`), content])).digest('hex');
    expect(gitBlob).toBe(blob);
  });

  it('records every approved hash and the MIT notice in PROVENANCE.md', () => {
    const provenance = readFileSync(new URL('PROVENANCE.md', UPSTREAM), 'utf8');
    for (const { file, blob, sha256 } of APPROVED) {
      expect(provenance).toContain(`apps/manual-planner/public/js/${file}`);
      expect(provenance).toContain(blob);
      expect(provenance).toContain(sha256);
    }
    expect(provenance).toContain('4beb491c44551b6e4207adcc7459c4b11407bcbc');
    expect(provenance).toContain('MIT License');
    expect(provenance).toContain('Copyright (c) 2026 Malcolm Jones');
  });

  it('imports only its sibling upstream files', () => {
    for (const { file } of APPROVED) {
      const source = readFileSync(new URL(file, UPSTREAM), 'utf8');
      const imports = [...source.matchAll(/^import .* from '([^']+)';$/gmu)].map((m) => m[1]);
      expect(imports.every((path) => path === './dates.js' || path === './ordering.js')).toBe(true);
    }
  });
});
