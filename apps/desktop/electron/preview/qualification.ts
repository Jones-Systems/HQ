export type PauseStage = 'pre-read' | 'first-capture' | 'post-read' | 'before-drain';
interface PauseEvent { stage: PauseStage; sessionId: string }
export function createQualificationBarrier() {
  let stage: PauseStage | null = null;
  let release: (() => void) | undefined;
  let paused: PauseEvent | null = null;
  const observers = new Set<(value: PauseEvent) => void>();
  return {
    pauseAt(value: PauseStage | null) { if (value !== null && !['pre-read', 'first-capture', 'post-read', 'before-drain'].includes(value)) throw Error('Invalid pause'); stage = value; },
    waitForPause() { return paused ? Promise.resolve(paused) : new Promise<PauseEvent>(resolve => observers.add(resolve)); },
    resume() { stage = null; paused = null; release?.(); release = undefined; },
    async checkpoint(value: PauseStage, sessionId: string) {
      if (stage !== value) return;
      paused = { stage: value, sessionId }; for (const observer of observers) observer(paused); observers.clear();
      await new Promise<void>(resolve => { release = resolve; });
    },
  };
}
