import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentSource, MotionFrame, MotionStudy, RenderInput } from '../src/contract.ts';
import { motionFrameMessage, parseSandboxMessage } from '../src/review/sandbox-channel.ts';
import type { SandboxEvent } from '../src/review/sandbox-channel.ts';
import { createSandboxNonce, sandboxFrameAttributes } from '../src/review/sandbox-document.ts';

export interface SandboxFrameProps {
  readonly source: ComponentSource;
  readonly input: RenderInput;
  /** Optional motion study frame applied inside the sandbox. */
  readonly motion?: { readonly study: MotionStudy; readonly frame: MotionFrame };
  /** Review-only probe script builder (isolation evidence). */
  readonly probe?: (nonce: string) => string;
  readonly onEvent?: (event: SandboxEvent) => void;
}

/**
 * Runs one component configuration in `sandbox="allow-scripts"` srcdoc. The
 * frame has an opaque origin and no preload; the host only listens for
 * validated size/status messages and only posts sampled motion styles.
 */
export function SandboxFrame({ source, input, motion, probe, onEvent }: SandboxFrameProps) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  // A new nonce per document keeps late messages from an old document out.
  const { nonce, attributes } = useMemo(() => {
    const fresh = createSandboxNonce();
    return {
      nonce: fresh,
      attributes: sandboxFrameAttributes(source, input, { nonce: fresh, ...(probe === undefined ? {} : { probe: probe(fresh) }) }),
    };
  }, [source, input, probe]);

  useEffect(() => {
    setReady(false);
    setError(null);
    const listener = (event: MessageEvent) => {
      const message = parseSandboxMessage(event, ref.current?.contentWindow, nonce);
      if (message === null) return;
      if (message.type === 'ready') setReady(true);
      if (message.type === 'error') setError(message.message);
      onEventRef.current?.(message);
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [nonce]);

  useEffect(() => {
    if (!ready || motion === undefined) return;
    ref.current?.contentWindow?.postMessage(motionFrameMessage(motion.study, motion.frame, nonce), '*');
  }, [ready, motion, nonce]);

  return <figure className="hqc-frame" data-ready={ready ? 'true' : 'false'}>
    <iframe
      ref={ref}
      sandbox={attributes.sandbox}
      srcDoc={attributes.srcdoc}
      allow={attributes.allow}
      referrerPolicy={attributes.referrerPolicy}
      title={attributes.title}
      width={attributes.width}
      height={attributes.height}
    />
    <figcaption>
      <span className="hqc-evidence">Web sandbox preview · not native evidence</span>
      <span className="hqc-mono">r{source.revision} · {source.digest.slice(7, 19)}</span>
      {error === null ? null : <span className="hqc-error" role="status">Component error: {error}</span>}
    </figcaption>
  </figure>;
}
