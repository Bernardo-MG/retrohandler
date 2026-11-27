import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  defaultSettings,
  type CollectionInfo,
  type DesktopApi,
  type ExportOptions,
  type ExportPlan,
  type GameMetadataInput,
  type IdentificationReceipt,
  type IdentificationUpdate,
  type LibraryEntry,
  type LibraryPage,
  type ScanReceipt,
  type ScanUpdate,
  type SettingsPatch,
  type StorageInfo
} from '../../src/shared';
import { ScanController } from '../../src/renderer/features/scanner/ScanController';
import { IdentificationController } from '../../src/renderer/features/identification/IdentificationController';
import { LibraryController } from '../../src/renderer/features/library/LibraryController';
import { CollectionController } from '../../src/renderer/features/collections/CollectionController';
import { ExportController } from '../../src/renderer/features/export/ExportController';
import { MetadataController } from '../../src/renderer/features/metadata/MetadataController';
import { SettingsController } from '../../src/renderer/features/settings/SettingsController';
import { PreferencesController } from '../../src/renderer/features/settings/PreferencesController';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function collection(rootPath = '/roms'): CollectionInfo {
  return { rootPath, label: 'Games', scannedAt: '', gameCount: 3, ignored: 0, warningCount: 0 };
}
function game(source = '/roms'): LibraryEntry {
  return {
    id: 'rom',
    source,
    relativePath: 'game.nes',
    name: 'Game (USA)',
    system: 'NES',
    extension: '.nes',
    bytes: 42
  };
}
const signal = () => new AbortController().signal;

test('scan owns its job, filters progress, prevents overlap, and releases subscriptions', async () => {
  const pending = deferred<ScanReceipt>();
  let listener: ((update: ScanUpdate) => void) | undefined;
  const cancelled: string[] = [];
  const errors: string[] = [];
  const completed: ScanReceipt[] = [];
  let choices = 0;
  const controller = new ScanController(
    {
      chooseRomFolder: async () => {
        choices++;
        return '/roms';
      },
      scanIndexedFolder: async () => pending.promise,
      cancelScan: async (id) => {
        cancelled.push(id);
        return true;
      },
      onScanProgress: (callback) => {
        listener = callback;
        return () => {
          listener = undefined;
        };
      }
    },
    () => 'scan_test'
  );
  const disconnect = controller.connect();
  let notifications = 0;
  const unsubscribe = controller.subscribe(() => notifications++);
  const initial = controller.getSnapshot();
  assert.equal(controller.getSnapshot(), initial);
  const run = controller.scan(
    async (receipt) => {
      completed.push(receipt);
    },
    (error) => errors.push(error)
  );
  await controller.scan(
    async () => {},
    () => {}
  );
  assert.equal(choices, 1);
  assert.equal(controller.getSnapshot().busy, true);
  const progress = {
    filesVisited: 3,
    gamesFound: 2,
    directoriesVisited: 1,
    ignored: 1,
    warnings: 0,
    currentPath: 'game.nes'
  };
  listener?.({ jobId: 'other', progress });
  assert.equal(controller.getSnapshot().progress, null);
  listener?.({ jobId: 'scan_test', progress });
  assert.equal(controller.getSnapshot().progress, progress);
  await controller.cancel((error) => errors.push(error));
  assert.deepEqual(cancelled, ['scan_test']);
  const receipt = { source: '/roms', gameCount: 2, warningCount: 1 };
  pending.resolve(receipt);
  await run;
  assert.deepEqual(completed, [receipt]);
  assert.match(errors.at(-1) ?? '', /1 warnings/);
  assert.deepEqual(controller.getSnapshot(), { busy: false, progress: null });
  assert.equal(initial.busy, false);
  assert.ok(notifications >= 3);
  const before = notifications;
  unsubscribe();
  disconnect();
  assert.equal(listener, undefined);
  await controller.cancel(() => {});
  assert.equal(notifications, before);
});

test('cancelled folder choice or failed scan does not call completion and releases busy state', async () => {
  let folder: string | null = null;
  let calls = 0;
  const errors: string[] = [];
  const controller = new ScanController({
    chooseRomFolder: async () => folder,
    scanIndexedFolder: async () => {
      calls++;
      throw new Error('Scan cancelled.');
    },
    cancelScan: async () => true,
    onScanProgress: () => () => {}
  });
  await controller.scan(
    async () => assert.fail('completion'),
    (error) => errors.push(error)
  );
  assert.equal(calls, 0);
  folder = '/roms';
  await controller.scan(
    async () => assert.fail('completion'),
    (error) => errors.push(error)
  );
  assert.equal(calls, 1);
  assert.equal(controller.getSnapshot().busy, false);
  assert.deepEqual(errors, ['', '']);
});

test('identification excludes concurrent imports, routes progress and refreshes on completion', async () => {
  const catalogue = deferred<{ name: string; count: number }>();
  const pending = deferred<IdentificationReceipt>();
  let listener: ((update: IdentificationUpdate) => void) | undefined;
  let calls = 0;
  let refreshes = 0;
  let cancelled = '';
  const controller = new IdentificationController(
    {
      importDat: () => catalogue.promise,
      identifyCollection: async () => {
        calls++;
        return pending.promise;
      },
      cancelIdentification: async (id) => {
        cancelled = id;
        return true;
      },
      onIdentificationProgress: (callback) => {
        listener = callback;
        return () => {
          listener = undefined;
        };
      }
    },
    () => 'identity_test'
  );
  const stop = controller.connect();
  const importing = controller.importDat(() => {});
  await controller.identify(
    '/roms',
    () => {},
    () => {}
  );
  assert.equal(calls, 0);
  catalogue.resolve({ name: 'DAT', count: 4 });
  await importing;
  assert.match(controller.getSnapshot().message, /Imported 4 DAT entries/);
  const running = controller.identify(
    '/roms',
    () => refreshes++,
    () => {}
  );
  const receipt = {
    processed: 1,
    verified: 1,
    probable: 0,
    ambiguous: 0,
    unknown: 0,
    unsupported: 0,
    errors: 0
  };
  const progress = { ...receipt, total: 1, currentPath: 'game.nes' };
  listener?.({ jobId: 'other', progress });
  assert.equal(controller.getSnapshot().progress, null);
  listener?.({ jobId: 'identity_test', progress });
  assert.equal(controller.getSnapshot().progress, progress);
  await controller.cancel(() => {});
  assert.equal(cancelled, 'identity_test');
  pending.resolve(receipt);
  await running;
  assert.equal(refreshes, 1);
  assert.match(controller.getSnapshot().message, /1 verified/);
  assert.equal(controller.getSnapshot().identifying, false);
  stop();
});

function libraryApi(
  overrides: Partial<
    Pick<
      DesktopApi,
      | 'listCollections'
      | 'listSystems'
      | 'queryLibrary'
      | 'bulkAssignSystem'
      | 'renameCollection'
      | 'removeCollection'
    >
  > = {}
) {
  return {
    listCollections: async () => [collection()],
    listSystems: async () => [{ system: 'NES', count: 3 }],
    queryLibrary: async () => ({ items: [game()], total: 1 }),
    bulkAssignSystem: async () => 3,
    renameCollection: async () => {},
    removeCollection: async () => {},
    ...overrides
  };
}

test('library hydration resets a missing collection and preserves presentation preferences', async () => {
  const controller = new LibraryController(
    libraryApi(),
    {
      ...defaultSettings().library,
      selected: '/missing',
      search: 'mario',
      system: 'SNES',
      identification: 'verified',
      view: 'grid'
    },
    (message) => assert.fail(message)
  );
  await controller.loadInitialCollections(signal());
  assert.equal(controller.getSnapshot().ready, true);
  assert.equal(controller.getSnapshot().preferences.selected, null);
  assert.equal(controller.getSnapshot().debouncedSearch, '');
  assert.equal(controller.getSnapshot().preferences.view, 'grid');
});

test('library ignores stale page responses even before React has cleaned up the previous effect', async () => {
  const first = deferred<LibraryPage>();
  const second = deferred<LibraryPage>();
  let calls = 0;
  const controller = new LibraryController(
    libraryApi({ queryLibrary: () => (++calls === 1 ? first.promise : second.promise) }),
    defaultSettings().library,
    (message) => assert.fail(message)
  );
  const old = controller.loadPage(signal());
  controller.selectCollection('/new');
  first.resolve({ items: [game('/old')], total: 1 });
  await old;
  assert.equal(controller.getSnapshot().page.total, 0);
  const current = controller.loadPage(signal());
  second.resolve({ items: [game('/new')], total: 1 });
  await current;
  assert.equal(controller.getSnapshot().page.items[0].source, '/new');
  assert.equal(controller.getSnapshot().loading, false);
});

test('library aborted requests never publish results or errors', async () => {
  const pending = deferred<LibraryPage>();
  const errors: string[] = [];
  const controller = new LibraryController(
    libraryApi({ queryLibrary: () => pending.promise }),
    defaultSettings().library,
    (error) => errors.push(error)
  );
  const request = new AbortController();
  const run = controller.loadPage(request.signal);
  request.abort();
  pending.reject(new Error('stale failure'));
  await run;
  assert.deepEqual(errors, []);
  assert.equal(controller.getSnapshot().page.total, 0);
});

test('library filters, selection and bulk assignment operate on current snapshots', async () => {
  const selections: Parameters<DesktopApi['bulkAssignSystem']>[0][] = [];
  const controller = new LibraryController(
    libraryApi({
      bulkAssignSystem: async (selection) => {
        selections.push(selection);
        return 3;
      }
    }),
    defaultSettings().library,
    (message) => assert.fail(message)
  );
  controller.selectCollection('/roms');
  controller.setOffset(100);
  controller.setDetails(game());
  controller.filterSearch('x'.repeat(300));
  assert.equal(controller.getSnapshot().preferences.search.length, 256);
  assert.equal(controller.getSnapshot().offset, 0);
  assert.equal(controller.getSnapshot().details, null);
  controller.setDebouncedSearch('old');
  assert.equal(controller.getSnapshot().debouncedSearch, '');
  controller.setDebouncedSearch('x'.repeat(256));
  assert.equal(controller.getSnapshot().debouncedSearch.length, 256);
  await controller.assignCollectionSystem('/roms', 'NES');
  assert.deepEqual(selections, [
    { scope: 'filtered', filter: { source: '/roms', search: '', system: null, identification: null } }
  ]);
  await controller.remove('/roms');
  assert.equal(controller.getSnapshot().preferences.selected, null);
});

test('collection actions require confirmation and use independent editable snapshots', async () => {
  let approved = false;
  const controller = new CollectionController(() => approved);
  const selected = collection();
  controller.beginAssignment(selected);
  controller.setSystem(' NES ');
  let value: string | null = null;
  const assign = async (_source: string, override: string | null) => {
    value = override;
    return 3;
  };
  await controller.applySelectedSystem(selected, false, assign);
  assert.equal(value, null);
  approved = true;
  await controller.applySelectedSystem(selected, false, assign);
  assert.equal(value, 'NES');
  assert.equal(controller.getSnapshot().assigning, null);
  controller.beginRename(selected);
  controller.setLabel('New label');
  await controller.saveName(selected, false, async () => {
    throw new Error('rename failed');
  });
  assert.equal(controller.getSnapshot().editing, selected.rootPath);
  assert.match(controller.getSnapshot().error, /rename failed/);
  assert.equal(controller.getSnapshot().saving, false);
});

function plan(): ExportPlan {
  return {
    destination: '/export',
    systems: ['nes'],
    skippedRoms: 0,
    bytes: 0,
    fingerprint: 'approved',
    warnings: [],
    conflicts: [],
    files: [{ source: '/roms/game.nes', relativeDestination: 'roms/nes/game.nes', size: 42, kind: 'rom' }]
  };
}

test('export requires a current valid preview and uses the approved fingerprint', async () => {
  const generated: { options: ExportOptions; fingerprint: string }[] = [];
  const controller = new ExportController(
    {
      listSystems: async () => [{ system: 'NES', count: 1 }],
      chooseExportFolder: async () => '/export',
      previewRetroPieExport: async () => plan(),
      runRetroPieExport: async (options, fingerprint) => {
        generated.push({ options, fingerprint });
        return { copied: 1, backups: ['backup'] };
      }
    },
    '/roms',
    defaultSettings().export
  );
  await controller.choose();
  await controller.run('/roms');
  assert.equal(generated.length, 0);
  controller.changeMapping('NES', 'NES');
  await controller.requestPreview('/roms');
  await controller.run('/other');
  assert.equal(generated.length, 0);
  await controller.run('/roms');
  assert.equal(generated[0].fingerprint, 'approved');
  assert.deepEqual(generated[0].options.overrides, { NES: 'nes' });
  assert.deepEqual(controller.getSnapshot().completed?.backups, ['backup']);
  assert.equal(controller.getSnapshot().plan, null);
});

test('export invalidates a preview when collection or mapping changes and rejects stale completion', async () => {
  const pending = deferred<ExportPlan>();
  let calls = 0;
  const controller = new ExportController(
    {
      listSystems: async () => [],
      chooseExportFolder: async () => null,
      previewRetroPieExport: () => (++calls === 1 ? pending.promise : Promise.resolve(plan())),
      runRetroPieExport: async () => assert.fail('stale preview executed')
    },
    '/roms',
    defaultSettings().export
  );
  const first = controller.requestPreview('/roms');
  await controller.loadSystems('/other', signal());
  pending.resolve(plan());
  await first;
  assert.equal(controller.getSnapshot().plan, null);
  await controller.requestPreview('/other');
  assert.ok(controller.getSnapshot().plan);
  controller.changeArtwork(false);
  assert.equal(controller.getSnapshot().plan, null);
  await controller.run('/other');
});

test('metadata workflows preserve chosen artwork, clear provider identity on manual save, and report errors', async () => {
  const entry = game();
  const saves: GameMetadataInput[] = [];
  let refreshes = 0;
  const controller = new MetadataController(
    {
      launchBoxSearch: async (query, system) => {
        assert.equal(query, 'Game');
        assert.equal(system, 'NES');
        return [{ id: 1, title: 'Match', released: '', slug: 'match' }];
      },
      launchBoxApply: async () => ({
        source: entry.source,
        relativePath: entry.relativePath,
        title: 'Match',
        description: '',
        released: '',
        developer: '',
        publisher: '',
        genre: '',
        provider: 'launchbox',
        providerId: '1',
        providerSlug: 'match',
        artworkId: null
      }),
      downloadLaunchBox: async () => {
        throw new Error('offline');
      },
      cancelLaunchBoxDownload: async () => true,
      importLaunchBox: async () => ({ count: 2 }),
      searchLibretroCovers: async () => [{ title: 'Cover', artworkId: 'cover' }],
      metadataSave: async (target, form) => {
        saves.push(form);
        return { ...target, ...form };
      },
      onLaunchBoxProgress: () => () => {}
    },
    entry,
    defaultSettings().metadata
  );
  await controller.search(entry);
  assert.equal(controller.getSnapshot().results.length, 1);
  await controller.apply(entry, 1, () => refreshes++);
  await controller.artwork(entry);
  controller.selectCover('cover');
  controller.setSystemOverride('  NES  ');
  await controller.save(entry, () => refreshes++);
  assert.equal(saves[0].provider, 'manual');
  assert.equal(saves[0].providerId, null);
  assert.equal(saves[0].artworkId, 'cover');
  assert.equal(saves[0].systemOverride, 'NES');
  assert.equal(refreshes, 2);
  await controller.updateLaunchBox();
  assert.equal(controller.getSnapshot().busy, false);
  assert.equal(controller.getSnapshot().updating, false);
  assert.match(controller.getSnapshot().error, /offline/);
});

const storage: StorageInfo = {
  databasePath: '/db',
  settingsPath: '/settings',
  artworkPath: '/artwork',
  artworkFiles: 3,
  artworkBytes: 123,
  reclaimableFiles: 1,
  reclaimableBytes: 10
};

test('settings edits are independent of saved settings; persistence sends only editable fields', async () => {
  const initial = defaultSettings();
  const patches: SettingsPatch[] = [];
  const controller = new SettingsController(
    {
      getStorageInfo: async () => storage,
      chooseExportFolder: async () => '/export',
      cleanupArtworkCache: async () => ({ removedFiles: 1, removedBytes: 10, failedFiles: 0 }),
      saveSettings: async (patch) => {
        patches.push(patch);
        return { ...initial, ...patch };
      },
      resetSettings: async () => defaultSettings()
    },
    initial
  );
  controller.changeTheme('light');
  controller.changeCollection('/roms');
  await controller.chooseDestination();
  await controller.cleanup();
  assert.match(controller.getSnapshot().notice, /1 files removed/);
  assert.equal(controller.getSnapshot().storage, storage);
  assert.equal(initial.appearance.theme, 'dark');
  assert.equal(initial.export.destination, '');
  await controller.save((saved) => assert.equal(saved.appearance.theme, 'light'));
  assert.deepEqual(Object.keys(patches[0]).sort(), ['appearance', 'export', 'library', 'metadata']);
  assert.equal(patches[0].export?.destination, '/export');
});

test('settings failure releases busy and stale storage responses are ignored', async () => {
  const pending = deferred<StorageInfo>();
  let requests = 0;
  const controller = new SettingsController(
    {
      getStorageInfo: () => (++requests === 1 ? pending.promise : Promise.resolve(storage)),
      chooseExportFolder: async () => null,
      cleanupArtworkCache: async () => ({ removedFiles: 0, removedBytes: 0, failedFiles: 0 }),
      saveSettings: async () => {
        throw new Error('disk error');
      },
      resetSettings: async () => defaultSettings()
    },
    defaultSettings()
  );
  const old = controller.refreshStorage();
  await controller.refreshStorage();
  pending.resolve({ ...storage, artworkFiles: 999 });
  await old;
  assert.equal(controller.getSnapshot().storage?.artworkFiles, 3);
  await controller.save(() => assert.fail('saved'));
  assert.equal(controller.getSnapshot().busy, false);
  assert.match(controller.getSnapshot().error, /disk error/);
});

test('preferences keep library state separate and surface persistence failures', async () => {
  const errors: string[] = [];
  const controller = new PreferencesController(
    {
      saveSettings: async () => {
        throw new Error('disk error');
      }
    },
    defaultSettings(),
    (error) => errors.push(error)
  );
  assert.equal(Object.hasOwn(controller.getSnapshot(), 'library'), false);
  await controller.persistLibrary(defaultSettings().library);
  assert.match(errors[0], /Could not save library preferences/);
  controller.rememberExport({ ...defaultSettings().export, destination: '/export' });
  assert.equal(controller.getSnapshot().export.destination, '/export');
  await Promise.resolve();
  assert.match(errors[1], /Could not save export preferences/);
});
