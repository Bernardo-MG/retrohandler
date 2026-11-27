import type { CollectionInfo } from '../../../shared';
import { ControllerState } from '../../controllers/controller-state';

interface CollectionState {
  editing: string | null;
  assigning: string | null;
  label: string;
  system: string;
  saving: boolean;
  error: string;
}
export interface CollectionActions {
  rename(source: string, label: string): Promise<void>;
  remove(source: string): Promise<void>;
  assignSystem(source: string, override: string | null): Promise<number>;
}

export class CollectionController extends ControllerState<CollectionState> {
  constructor(private readonly confirm: (message: string) => boolean) {
    super({ editing: null, assigning: null, label: '', system: '', saving: false, error: '' });
  }

  public readonly setLabel = (label: string): void => this.update({ label });
  public readonly setSystem = (system: string): void => this.update({ system });
  public readonly beginAssignment = (collection: CollectionInfo): void => {
    this.update({ assigning: collection.rootPath, editing: null, system: '', error: '' });
  };
  public readonly beginRename = (collection: CollectionInfo): void => {
    this.update({ assigning: null, editing: collection.rootPath, label: collection.label });
  };
  public readonly cancelAssignment = (): void => this.update({ assigning: null, error: '' });
  public readonly cancelRename = (): void => this.update({ editing: null });

  public async saveName(
    collection: CollectionInfo,
    busy: boolean,
    rename: CollectionActions['rename']
  ): Promise<void> {
    const { saving, label } = this.getSnapshot();
    if (saving || busy) {
      return;
    }
    this.update({ saving: true, error: '' });
    try {
      await rename(collection.rootPath, label);
      this.update({ editing: null });
    } catch (reason) {
      this.update({ error: String(reason) });
    } finally {
      this.update({ saving: false });
    }
  }

  public async forget(collection: CollectionInfo, remove: CollectionActions['remove']): Promise<void> {
    if (
      !this.confirm(`Forget “${collection.label}” from RetroHandler? Your ROM files will not be deleted.`)
    ) {
      return;
    }
    try {
      await remove(collection.rootPath);
    } catch (reason) {
      this.update({ error: String(reason) });
    }
  }

  public applySelectedSystem(
    collection: CollectionInfo,
    busy: boolean,
    assignSystem: CollectionActions['assignSystem']
  ): Promise<void> {
    return this.applySystem(collection, this.getSnapshot().system.trim(), busy, assignSystem);
  }
  public clearSystem(
    collection: CollectionInfo,
    busy: boolean,
    assignSystem: CollectionActions['assignSystem']
  ): Promise<void> {
    return this.applySystem(collection, null, busy, assignSystem);
  }

  private async applySystem(
    collection: CollectionInfo,
    override: string | null,
    busy: boolean,
    assignSystem: CollectionActions['assignSystem']
  ): Promise<void> {
    if (this.getSnapshot().saving || busy) {
      return;
    }
    const action = override ? `set the system to “${override}”` : 'clear manual system assignments';
    if (
      !this.confirm(
        `This will ${action} for all ${collection.gameCount.toLocaleString()} ROMs in “${collection.label}”. Continue?`
      )
    ) {
      return;
    }
    this.update({ saving: true, error: '' });
    try {
      await assignSystem(collection.rootPath, override);
      this.update({ assigning: null, system: '' });
    } catch (reason) {
      this.update({ error: String(reason) });
    } finally {
      this.update({ saving: false });
    }
  }
}
