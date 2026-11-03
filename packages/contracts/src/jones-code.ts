type Id<K extends string> = string & { readonly __kind: K };
export interface JonesModel { readonly provider: string; readonly model: string }
export interface JonesIdentity { readonly hostId: Id<'HostId'>; readonly receiverId: Id<'ReceiverId'>; readonly fingerprint: string }
export interface JonesReceipt { readonly receiptId: Id<'ReceiptId'>; readonly idempotencyKey: string; readonly status: 'accepted' | 'held'; readonly observedHostId: Id<'HostId'>; readonly observedReceiverId: Id<'ReceiverId'>; readonly observedModel: JonesModel | null; readonly at: string; readonly provenance: 'jones'; readonly reason?: string }
export interface JonesHandoff {
  readonly schema: 'hq.design.handoff/v1'; readonly dispatchId: Id<'DispatchId'>; readonly attemptId: Id<'AttemptId'>; readonly idempotencyKey: string;
  readonly packet: { readonly packetId: Id<'PacketId'>; readonly packetDigest: `sha256:${string}` }; readonly packetBody: unknown;
  readonly destination: { readonly destinationId: Id<'DestinationId'>; readonly hostId: Id<'HostId'>; readonly receiverId: Id<'ReceiverId'>; readonly fingerprint: string; readonly threadRef: Id<'ThreadRef'> | null; readonly model: JonesModel | null };
  readonly fallback: 'forbidden'; readonly confirmedAt: string;
}
export type JonesSendOutcome = { readonly kind: 'accepted'; readonly receipt: JonesReceipt } | { readonly kind: 'held'; readonly receipt: JonesReceipt } | { readonly kind: 'rejected'; readonly reason: string };
export type JonesLookupOutcome = { readonly kind: 'found'; readonly receipt: JonesReceipt } | { readonly kind: 'rejected'; readonly reason: string } | { readonly kind: 'no-effect'; readonly basis: string } | { readonly kind: 'not-found' } | { readonly kind: 'unavailable'; readonly detail: string };
export type JonesFenceOutcome = Extract<JonesLookupOutcome, { kind: 'found' | 'no-effect' | 'unavailable' }>;
export interface JonesDescriptor { readonly kind: 'jones-code'; readonly label: string; readonly provenance: 'jones'; readonly modes: readonly ('existing-thread' | 'new-thread')[]; readonly qualification: { readonly level: 'unqualified'; readonly reason: string } | { readonly level: 'qualified'; readonly evidenceRef: string } }
export interface JonesDestination { readonly deliveryQualified: boolean; readonly deliveryReason: string; readonly destinationId: Id<'DestinationId'>; readonly label: string; readonly endpoint: { readonly transport: 'jones-code'; readonly locator: string }; readonly mode: 'existing-thread' | 'new-thread'; readonly identity: JonesIdentity; readonly threadRef?: Id<'ThreadRef'>; readonly model?: JonesModel; readonly freshness: { readonly status: 'fresh' | 'stale'; readonly lastSuccessAt: string | null; readonly generation: number }; readonly status: 'reachable' | 'unknown' }
export interface JonesStatus { readonly state: 'not-configured' | 'needs-authorization' | 'authorizing' | 'connected' | 'unavailable'; readonly descriptor: JonesDescriptor; readonly destinations: readonly JonesDestination[]; readonly profiles?: readonly { readonly token: string; readonly label: string; readonly active: boolean }[] }
export interface JonesSelection { readonly token: string; readonly label: string; readonly kind: 'project' | 'thread' }
export interface JonesParams {
  readonly 'jonesCode.selectProfile': { readonly token: string };
  readonly 'jonesCode.status': Record<string, never>;
  readonly 'jonesCode.configure': { readonly baseUrl: string; readonly label: string };
  readonly 'jonesCode.authorize': Record<string, never>;
  readonly 'jonesCode.projects': Record<string, never>;
  readonly 'jonesCode.bind': { readonly token: string; readonly mode: 'existing-thread' | 'new-thread'; readonly label: string };
  readonly 'jonesCode.identify': { readonly locator: string };
  readonly 'jonesCode.send': { readonly locator: string; readonly handoff: JonesHandoff };
  readonly 'jonesCode.lookup': { readonly locator: string; readonly idempotencyKey: string };
  readonly 'jonesCode.fence': { readonly locator: string; readonly idempotencyKey: string };
  readonly 'jonesCode.readEvidence': { readonly locator: string; readonly dispatchId: Id<'DispatchId'>; readonly attemptId: Id<'AttemptId'>; readonly idempotencyKey: string; readonly receiptId: Id<'ReceiptId'> };
  readonly 'jonesCode.listThreads': { readonly token: string };
}
export interface JonesValues {
  readonly 'jonesCode.selectProfile': JonesStatus;
  readonly 'jonesCode.status': JonesStatus; readonly 'jonesCode.configure': JonesStatus; readonly 'jonesCode.authorize': JonesStatus;
  readonly 'jonesCode.projects': readonly JonesSelection[]; readonly 'jonesCode.bind': JonesStatus; readonly 'jonesCode.identify': JonesIdentity;
  readonly 'jonesCode.send': JonesSendOutcome; readonly 'jonesCode.lookup': JonesLookupOutcome; readonly 'jonesCode.fence': JonesFenceOutcome;
  readonly 'jonesCode.readEvidence': { readonly kind: 'found'; readonly documents: readonly unknown[] } | { readonly kind: 'none-yet' } | { readonly kind: 'unavailable'; readonly detail: string };
  readonly 'jonesCode.listThreads': readonly JonesSelection[];
}
export type JonesResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly kind: 'invalid' | 'unavailable' | 'unknown'; readonly reason?: string };
export interface JonesTransport { call<R extends keyof JonesParams>(route: R, params: JonesParams[R]): Promise<JonesResult<JonesValues[R]>> }
