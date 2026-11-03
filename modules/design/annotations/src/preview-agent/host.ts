import { installPreviewAgent } from './agent.ts';
import type { AgentHost, AgentOptions, PreviewAgent } from './agent.ts';
import type { AgentEvent } from './types.ts';

export const PREVIEW_QUEUE_CAPACITY = 64;

export interface PreviewAgentQueue extends AgentHost {
  readonly size: number;
  /** Cumulative overflow count; draining does not reset it. */
  readonly dropped: number;
  drain(): AgentEvent[];
}

export function createPreviewAgentQueue(): PreviewAgentQueue {
  const events: AgentEvent[] = [];
  let dropped = 0;
  return {
    get size() { return events.length; },
    get dropped() { return dropped; },
    post(event) {
      if (events.length === PREVIEW_QUEUE_CAPACITY) { events.shift(); dropped += 1; }
      events.push(event);
    },
    drain() { return events.splice(0); },
  };
}

export interface PreviewAgentHost {
  readonly agent: PreviewAgent;
  readonly size: number;
  readonly dropped: number;
  drain(): AgentEvent[];
  dispose(): void;
}

// This slot lives on the isolated world's Window, survives bundle re-evaluation,
// and is never installed on the site's main world by this module.
const HOST_SLOT = '__hqPreviewAgentHostV1';
type HostWindow = Window & { [HOST_SLOT]?: PreviewAgentHost };

/** Call in isolated world 1001. Main owns injection, polling and output validation. */
export function installPreviewAgentHost(win: Window, options: AgentOptions = {}): PreviewAgentHost {
  if (win.top !== win.self) throw new Error('Preview agent requires the main frame');
  const target = win as HostWindow;
  if (target[HOST_SLOT] !== undefined) return target[HOST_SLOT];
  const queue = createPreviewAgentQueue();
  const agent = installPreviewAgent(win, queue, options);
  const host: PreviewAgentHost = {
    agent,
    get size() { return queue.size; },
    get dropped() { return queue.dropped; },
    drain: () => queue.drain(),
    dispose() {
      agent.dispose();
      queue.drain();
      if (target[HOST_SLOT] === host) delete target[HOST_SLOT];
    },
  };
  target[HOST_SLOT] = host;
  return host;
}
