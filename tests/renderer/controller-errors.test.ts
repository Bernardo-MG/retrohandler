import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultSettings, type CollectionInfo, type DesktopApi, type LibraryEntry } from '../../src/shared';
import { CollectionController } from '../../src/renderer/features/collections/CollectionController';
import { LibraryController } from '../../src/renderer/features/library/LibraryController';
import { MetadataController } from '../../src/renderer/features/metadata/MetadataController';
import { SettingsController } from '../../src/renderer/features/settings/SettingsController';

const collection: CollectionInfo = {
  rootPath: '/roms',
  label: 'Games',
  scannedAt: '',
  gameCount: 1,
  ignored: 0,
  warningCount: 0
};
const entry: LibraryEntry = {
  id: 'rom',
  source: collection.rootPath,
  relativePath: 'game.nes',
  name: 'Game',
  system: 'NES',
  extension: '.nes',
  bytes: 42
};

const reject = async (): Promise<never> => {
  throw new Error('Unavailable');
};

describe('LibraryController', () => {
  const api: Pick<
    DesktopApi,
    | 'listCollections'
    | 'listSystems'
    | 'queryLibrary'
    | 'bulkAssignSystem'
    | 'renameCollection'
    | 'removeCollection'
  > = {
    listCollections: reject,
    listSystems: reject,
    queryLibrary: reject,
    bulkAssignSystem: reject,
    renameCollection: reject,
    removeCollection: reject
  };

  it('finishes hydration and page loading even when the API fails', async () => {
    const errors: string[] = [];
    const controller = new LibraryController(api, defaultSettings().library, (message) =>
      errors.push(message)
    );
    const signal = new AbortController().signal;

    await controller.loadInitialCollections(signal);
    await controller.loadPage(signal);
    await controller.loadSystems(null, 0, signal);

    assert.equal(controller.getSnapshot().ready, true);
    assert.equal(controller.getSnapshot().loading, false);
    assert.equal(controller.getSnapshot().page.total, 0);
    assert.equal(errors.length, 3);
    assert.match(errors[0], /Could not load collections/);
    assert.ok(errors.every((error) => error.includes('Unavailable')));
  });

  it('preserves the selected collection and revision when renaming or removal fails', async () => {
    const errors: string[] = [];
    const controller = new LibraryController(api, defaultSettings().library, (message) =>
      errors.push(message)
    );
    controller.selectCollection(collection.rootPath);

    await controller.rename(collection.rootPath, 'New label');
    await controller.remove(collection.rootPath);

    assert.equal(controller.getSnapshot().preferences.selected, collection.rootPath);
    assert.equal(controller.getSnapshot().revision, 0);
    assert.equal(errors.length, 2);
  });

  it('clears a system filter when that system is no longer available', async () => {
    const initial = { ...defaultSettings().library, selected: collection.rootPath, system: 'NES' };
    const controller = new LibraryController(
      { ...api, listSystems: async () => [{ system: 'SNES', count: 1 }] },
      initial,
      assert.fail
    );
    controller.setOffset(100);
    controller.setDetails(entry);

    await controller.loadSystems(collection.rootPath, 0, new AbortController().signal);

    assert.equal(controller.getSnapshot().preferences.system, null);
    assert.equal(controller.getSnapshot().offset, 0);
    assert.equal(controller.getSnapshot().details, null);
  });
});

describe('CollectionController', () => {
  it('does not remove a collection when confirmation is declined', async () => {
    const controller = new CollectionController(() => false);
    await controller.forget(collection, async () => assert.fail('Unexpected removal'));
    assert.equal(controller.getSnapshot().error, '');
  });

  it('reports assignment failure without discarding the editor, and permits retry', async () => {
    const controller = new CollectionController(() => true);
    controller.beginAssignment(collection);
    await controller.clearSystem(collection, false, reject);
    assert.match(controller.getSnapshot().error, /Unavailable/);
    assert.equal(controller.getSnapshot().assigning, collection.rootPath);
    assert.equal(controller.getSnapshot().saving, false);

    await controller.clearSystem(collection, false, async (source, override) => {
      assert.equal(source, collection.rootPath);
      assert.equal(override, null);
      return 1;
    });
    assert.equal(controller.getSnapshot().assigning, null);
    assert.equal(controller.getSnapshot().error, '');
  });
});

describe('MetadataController', () => {
  it('reports failed searches and cancellation, and allows a later successful search', async () => {
    let failing = true;
    const controller = new MetadataController(
      {
        launchBoxSearch: async () =>
          failing ? reject() : [{ id: 1, title: 'Game', released: '', slug: null }],
        launchBoxApply: reject,
        downloadLaunchBox: reject,
        cancelLaunchBoxDownload: reject,
        importLaunchBox: async () => null,
        searchLibretroCovers: async () => [],
        metadataSave: reject,
        onLaunchBoxProgress: () => () => {}
      },
      entry,
      defaultSettings().metadata
    );

    await controller.search(entry);
    assert.equal(controller.getSnapshot().busy, false);
    assert.match(controller.getSnapshot().error, /Unavailable/);
    failing = false;
    await controller.search(entry);
    assert.equal(controller.getSnapshot().results.length, 1);
    assert.equal(controller.getSnapshot().error, '');
    await controller.artwork(entry);
    assert.match(controller.getSnapshot().notice, /No downloadable box art/);
    await controller.cancelLaunchBox();
    assert.match(controller.getSnapshot().error, /Unavailable/);
  });
});

describe('SettingsController', () => {
  it('surfaces storage and reset failures without leaving the dialog busy', async () => {
    const controller = new SettingsController(
      {
        getStorageInfo: reject,
        chooseExportFolder: reject,
        cleanupArtworkCache: reject,
        saveSettings: reject,
        resetSettings: reject
      },
      defaultSettings()
    );

    await controller.refreshStorage();
    assert.equal(controller.getSnapshot().storageLoading, false);
    assert.equal(controller.getSnapshot().storage, null);
    assert.match(controller.getSnapshot().storageError, /Unavailable/);
    await controller.cleanup();
    assert.equal(controller.getSnapshot().busy, false);
    await controller.chooseDestination();
    assert.match(controller.getSnapshot().error, /Unavailable/);
    await controller.reset(() => assert.fail('Unexpected reset'));
    assert.equal(controller.getSnapshot().busy, false);
    assert.match(controller.getSnapshot().error, /Unavailable/);
  });
});
