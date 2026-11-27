import { channels, type ProgressMethod, type RequestMethod } from '../../ipc-channels';
import type { DesktopApi } from '../../shared';
import { subscribe } from './ipc-subscription';

export type ProgressHandler = (event: unknown, update: unknown) => void;

type ProgressPayloads = {
  [K in ProgressMethod]: Parameters<Parameters<DesktopApi[K]>[0]>[0];
};

/** Only the three transport operations needed by the bridge. */
export interface IpcTransport {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, handler: ProgressHandler): unknown;
  removeListener(channel: string, handler: ProgressHandler): unknown;
}

export class IpcClient {
  constructor(private readonly transport: IpcTransport) {}

  public invoke<K extends RequestMethod>(
    method: K,
    ...args: Parameters<DesktopApi[K]>
  ): ReturnType<DesktopApi[K]> {
    // The main process validates requests and owns the corresponding response contract.
    return this.transport.invoke(channels[method], ...args) as ReturnType<DesktopApi[K]>;
  }

  public subscribe<K extends ProgressMethod>(
    method: K,
    listener: (update: ProgressPayloads[K]) => void
  ): () => void {
    return subscribe(this.transport, channels[method], listener);
  }
}
