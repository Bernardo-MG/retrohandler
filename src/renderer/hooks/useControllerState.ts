import { useState, useSyncExternalStore } from 'react';

interface ObservableController<State> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): State;
}

/** React owns the lifetime of a controller; the controller owns its workflow state. */
export function useControllerState<Controller extends ObservableController<unknown>>(create: () => Controller): readonly [Controller, ReturnType<Controller['getSnapshot']>] {
  const [controller] = useState(create);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot) as ReturnType<Controller['getSnapshot']>;
  return [controller, snapshot];
}
