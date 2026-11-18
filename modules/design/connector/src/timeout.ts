/** Bounded wait shared by the outbox and read-only evidence readback. Aborts the signal on expiry. */

export class TimeoutError extends Error {
  override readonly name = 'TimeoutError';
}

export async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(`Timed out after ${ms} ms`));
    }, ms);
  });
  try {
    return await Promise.race([run(controller.signal), expired]);
  } finally {
    clearTimeout(timer);
  }
}

export function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : 'non-error failure';
}
