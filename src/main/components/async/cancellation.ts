/** Keep cancellation distinguishable from ordinary I/O failures. */
export function throwIfCancelled(signal?: AbortSignal, message = 'Operation cancelled.'): void {
  if (signal?.aborted) {
    const error = new Error(message);
    error.name = 'AbortError';
    throw error;
  }
}
