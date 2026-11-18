import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ComponentSource, DesignSystemId, MotionStudyId, ProjectId, RenderInput } from '../src/contract.ts';
import {
  SYNTHETIC_BUTTON, SYNTHETIC_BUTTON_VARIANTS, SYNTHETIC_CARD, SYNTHETIC_CARD_VARIANTS, SYNTHETIC_MOTION, SYNTHETIC_SYSTEM,
} from '../src/fixtures.ts';
import { webCryptoDigest } from '../src/model/jcs.ts';
import { resolveRenderInput } from '../src/model/props.ts';
import { resolveTokens } from '../src/model/tokens.ts';
import { createComponentsCanvasProvider, motionItemKey } from '../src/review/canvas-provider.ts';
import { isolationProbeScript, judgeProbe } from '../src/review/isolation-probe.ts';
import type { ProbeVerdict } from '../src/review/isolation-probe.ts';
import type { SandboxEvent } from '../src/review/sandbox-channel.ts';
import { ComponentLibrary } from '../src/workspace/library.ts';
import { createMemoryStorage, performanceClock } from '../src/workspace/fakes.ts';
import { ComponentsWorkspace, SandboxFrame } from '../ui/index.ts';
import '../ui/components.css';

/**
 * REVIEW HARNESS with LABELLED FAKES: in-memory storage, synthetic fixtures and
 * a stand-in for the shell preload global. It proves browser behavior only;
 * Electron isolation needs root's typed preview integration.
 */
const PRELOAD_STUB = Object.freeze({ platform: 'desktop', versions: Object.freeze({ electron: null }), label: 'FAKE preload stub' });
Object.defineProperty(window, 'hqDesktop', { value: PRELOAD_STUB, enumerable: true });

interface HarnessState {
  mode: string;
  events: SandboxEvent[];
  probe: Readonly<Record<string, string>> | null;
  verdict: ProbeVerdict | null;
  providerFrames: number;
}

const harness: HarnessState = { mode: document.body.dataset.harness ?? 'unknown', events: [], probe: null, verdict: null, providerFrames: 0 };
Object.defineProperty(window, '__hqcHarness', { value: harness });

const storage = createMemoryStorage();
const library = new ComponentLibrary(storage, webCryptoDigest);
const PROJECT = 'synthetic-project' as ProjectId;

async function seed() {
  const button = await library.saveSource(SYNTHETIC_BUTTON);
  await library.saveVariants(button, { componentId: button.componentId, sourceRevision: 1, variants: SYNTHETIC_BUTTON_VARIANTS });
  const card = await library.saveSource(SYNTHETIC_CARD);
  await library.saveVariants(card, { componentId: card.componentId, sourceRevision: 1, variants: SYNTHETIC_CARD_VARIANTS });
  const system = await library.saveDesignSystem(SYNTHETIC_SYSTEM);
  const study = await library.saveMotionStudy(SYNTHETIC_MOTION);
  await library.setProjectMembership({ projectId: PROJECT, components: [{ componentId: card.componentId, revision: 1 }], studies: [{ studyId: study.id, revision: 1 }] });
  return { button, tokens: resolveTokens(system).values };
}

function ProbePanel({ source, input }: { readonly source: ComponentSource; readonly input: RenderInput }) {
  const [verdict, setVerdict] = useState<ProbeVerdict | null>(null);
  const [results, setResults] = useState<Readonly<Record<string, string>> | null>(null);
  return <section className="hqc-panel" aria-label="Isolation probe" id="probe">
    <h2>Isolation probe</h2>
    <SandboxFrame source={source} input={input} probe={isolationProbeScript} onEvent={(event) => {
      harness.events.push(event);
      if (event.type !== 'probe') return;
      const judged = judgeProbe(event.results);
      harness.probe = event.results;
      harness.verdict = judged;
      setResults(event.results);
      setVerdict(judged);
    }} />
    <p id="probe-verdict" data-passed={verdict === null ? 'pending' : String(verdict.passed)}>
      {verdict === null ? 'No probe report received from the sandbox.' : verdict.passed ? 'Isolated: every host reach was blocked.' : `NOT isolated: ${[...verdict.failures, ...verdict.missing].join(', ')}`}
    </p>
    {results === null ? null : <table className="hqc-token-table"><tbody>
      {Object.entries(results).map(([name, value]) => <tr key={name}><th scope="row" className="hqc-mono">{name}</th><td className="hqc-mono">{value}</td></tr>)}
    </tbody></table>}
  </section>;
}

function ProviderPanel() {
  const host = useRef<HTMLDivElement>(null);
  const provider = useMemo(() => createComponentsCanvasProvider({ library, digest: webCryptoDigest, designSystemId: SYNTHETIC_SYSTEM.id as DesignSystemId }), []);
  const [titles, setTitles] = useState<string[]>([]);
  useEffect(() => {
    void provider.listItems(PROJECT).then((items) => setTitles(items.map((item) => `${item.kind}: ${item.title} (${item.evidence})`)));
    if (host.current === null) return;
    const handle = provider.mount(motionItemKey(PROJECT, SYNTHETIC_MOTION.id as MotionStudyId, 1), host.current);
    const timer = setInterval(() => { harness.providerFrames = host.current?.querySelectorAll('iframe').length ?? 0; }, 200);
    return () => { clearInterval(timer); handle.dispose(); };
  }, [provider]);
  return <section className="hqc-panel" aria-label="Canvas provider" id="provider">
    <h2>CanvasItemProvider (fake canvas host)</h2>
    <ul>{titles.map((title) => <li key={title}>{title}</li>)}</ul>
    <div ref={host} id="provider-host" />
  </section>;
}

function Harness() {
  const [seeded, setSeeded] = useState<{ button: ComponentSource; tokens: Readonly<Record<string, string>> } | null>(null);
  const [appearance, setAppearance] = useState<'light' | 'dark'>('light');
  useEffect(() => { void seed().then(setSeeded); }, []);
  const probeInput = useMemo(() => (seeded === null ? null : resolveRenderInput(seeded.button, null, null, {}, seeded.tokens)), [seeded]);
  if (seeded === null || probeInput === null) return <p>Seeding synthetic fixtures…</p>;
  return <main>
    <header className="hqc-root" data-appearance={appearance}>
      <strong>T10 harness · {harness.mode} · FAKE storage and preload stub · synthetic fixtures</strong>{' '}
      <label><input type="checkbox" checked={appearance === 'dark'} onChange={(event) => setAppearance(event.target.checked ? 'dark' : 'light')} /> Dark chrome</label>
    </header>
    <ComponentsWorkspace library={library} clock={performanceClock} appearance={appearance} />
    <div className="hqc-root" data-appearance={appearance}>
      <ProbePanel source={seeded.button} input={probeInput} />
      <ProviderPanel />
    </div>
  </main>;
}

createRoot(document.getElementById('root') as HTMLElement).render(<StrictMode><Harness /></StrictMode>);
