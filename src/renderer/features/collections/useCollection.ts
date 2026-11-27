import type { FormEvent } from 'react';
import type { CollectionInfo } from '../../../shared';
import { useControllerState } from '../../hooks/useControllerState';
import { CollectionController, type CollectionActions } from './CollectionController';

export interface CollectionPanelProps extends CollectionActions {
  collections: CollectionInfo[];
  selected: string | null;
  busy: boolean;
  select(source: string | null): void;
}

export function useCollection({ collections, selected, busy, select, rename, remove, assignSystem }: CollectionPanelProps) {
  const [controller, state] = useControllerState(() => new CollectionController(message => window.confirm(message)));
  function submitName(event: FormEvent<HTMLFormElement>, collection: CollectionInfo) {
    event.preventDefault();
    void controller.saveName(collection, busy, rename);
  }
  return {
    ...state, collections, selected, busy, select,
    totalGames: collections.reduce((sum, collection) => sum + collection.gameCount, 0),
    setLabel: controller.setLabel, setSystem: controller.setSystem,
    beginAssignment: controller.beginAssignment, beginRename: controller.beginRename,
    cancelAssignment: controller.cancelAssignment, cancelRename: controller.cancelRename,
    submitName, forget: (collection: CollectionInfo) => controller.forget(collection, remove),
    applySelectedSystem: (collection: CollectionInfo) => controller.applySelectedSystem(collection, busy, assignSystem),
    clearSystem: (collection: CollectionInfo) => controller.clearSystem(collection, busy, assignSystem)
  };
}

export type CollectionViewModel = ReturnType<typeof useCollection>;
