import { throwIfCancelled } from '../components/async/cancellation';

/** The small part of WebContents required to own a renderer job. */
export interface JobSender {
  readonly id: number;
  isDestroyed(): boolean;
  once(event: 'destroyed', listener: () => void): unknown;
  removeListener(event: 'destroyed', listener: () => void): unknown;
  send(channel: string, ...args: unknown[]): void;
}

interface ActiveJob {
  id: string;
  controller: AbortController;
}

export class RendererJobs {
  private readonly active = new Map<number, ActiveJob>();

  constructor(private readonly messages: { busy: string; destroyed: string }) {}

  async run<T>(sender: JobSender, id: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (sender.isDestroyed()) {
      throw new Error(this.messages.destroyed);
    }
    const senderId = sender.id;
    if (this.active.has(senderId)) {
      throw new Error(this.messages.busy);
    }
    const controller = new AbortController();
    const onDestroyed = () => controller.abort();
    this.active.set(senderId, { id, controller });
    try {
      sender.once('destroyed', onDestroyed);
      if (sender.isDestroyed()) {
        controller.abort();
      }
      throwIfCancelled(controller.signal);
      return await work(controller.signal);
    } finally {
      this.active.delete(senderId);
      sender.removeListener('destroyed', onDestroyed);
    }
  }

  cancel(senderId: number, id: unknown): boolean {
    const job = this.active.get(senderId);
    if (!job || job.id !== id) {
      return false;
    }
    job.controller.abort();
    return true;
  }
}

export function sendProgress(sender: JobSender, channel: string, payload: unknown): void {
  if (!sender.isDestroyed()) {
    sender.send(channel, payload);
  }
}
