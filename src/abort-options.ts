export type AbortOptions = Readonly<{ signal?: AbortSignal }>;

export function throwIfAborted(options?: AbortOptions): void {
  options?.signal?.throwIfAborted();
}

export function forwardAbortSignal(
  signal: AbortSignal | undefined,
  controller: AbortController,
): () => void {
  if (signal === undefined) return () => {};
  if (signal.aborted) {
    controller.abort(signal.reason);
    return () => {};
  }
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  return () => signal.removeEventListener("abort", abort);
}
