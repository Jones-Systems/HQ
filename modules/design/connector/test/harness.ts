/** Test harness wiring the outbox to labelled fakes with a shared ordering trace. */

import type { StoredDispatch, TransportRegistry } from '../src/contract.ts';
import type { Destination } from '../src/host-catalog.ts';
import type { Outbox, SubmitRequest } from '../src/outbox.ts';
import type { ManualHandoffHistoryPort } from '../src/route-fence.ts';
import { createConfirmation } from '../src/confirmation.ts';
import { createFakeClock, createFakeReceiver, createMemoryOutboxStore, createTrace, syntheticDestination, syntheticIdentity, syntheticPacket } from '../src/fakes.ts';
import type { FakeClock, FakeReceiver, MemoryOutboxStore, SyntheticPacket, Trace } from '../src/fakes.ts';
import { createOutbox } from '../src/outbox.ts';

export interface Harness {
  readonly clock: FakeClock;
  readonly trace: Trace;
  readonly receiver: FakeReceiver;
  readonly store: MemoryOutboxStore;
  readonly transports: TransportRegistry;
  readonly packet: SyntheticPacket;
  readonly destination: Destination;
  outbox: Outbox;
  /** Simulate a process restart: new store handle and outbox over the same durable backing. */
  restart(): Outbox;
  /** Build a request with a confirmation made now (advance the clock first for a fresh one). */
  request(overrides?: { destination?: Destination; shown?: Destination }): SubmitRequest;
}

let confirmationSeq = 0;

export async function createHarness(options: {
  readonly sendTimeoutMs?: number;
  readonly backing?: Map<string, StoredDispatch>;
  readonly manualHandoffs?: ManualHandoffHistoryPort;
} = {}): Promise<Harness> {
  const clock = createFakeClock();
  const trace = createTrace();
  const receiver = createFakeReceiver({ identity: syntheticIdentity(), clock, trace });
  const transports: TransportRegistry = { 'fake-receiver': receiver };
  const packet = await syntheticPacket();
  const destination = syntheticDestination();
  let store = createMemoryOutboxStore({ trace, ...(options.backing ? { backing: options.backing } : {}) });
  let session = 0;
  const make = () => createOutbox({
    store, transports, clock, sessionId: `session-${(session += 1)}`,
    sendTimeoutMs: options.sendTimeoutMs ?? 50, probeTimeoutMs: 50,
    ...(options.manualHandoffs ? { manualHandoffs: options.manualHandoffs } : {}),
  });
  const harness: Harness = {
    clock, trace, receiver, transports, packet, destination,
    get store() { return store; },
    outbox: make(),
    restart() {
      store = createMemoryOutboxStore({ backing: store.backing, trace });
      harness.outbox = make();
      return harness.outbox;
    },
    request(overrides = {}) {
      const target = overrides.destination ?? destination;
      return {
        packet,
        destination: target,
        confirmation: createConfirmation({
          packet, destination: overrides.shown ?? target, clock, newId: () => `test-${(confirmationSeq += 1)}`,
        }),
      };
    },
  };
  return harness;
}
