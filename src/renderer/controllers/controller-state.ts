/** Immutable-by-replacement snapshots for framework-independent UI workflows. */
export abstract class ControllerState<State extends object> {
  private readonly listeners = new Set<() => void>();

  protected constructor(private state: Readonly<State>) { }

  readonly getSnapshot = (): Readonly<State> => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  protected update(patch: Partial<State>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}
