import type { IpcTransport, ProgressHandler } from './ipc-client';

/** Never expose the Electron event or its sender to the isolated renderer. */
export function subscribe<T>(
  transport: IpcTransport,
  channel: string,
  listener: (update: T) => void
): () => void {
  const handler: ProgressHandler = (_event, update) => listener(update as T);
  transport.on(channel, handler);
  return () => {
    transport.removeListener(channel, handler);
  };
}
