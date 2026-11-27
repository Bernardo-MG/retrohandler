import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultSettings, type LibraryEntry, type GameMetadataInput } from '../../src/shared';
import { MetadataController } from '../../src/renderer/features/metadata/MetadataController';
import { SettingsController } from '../../src/renderer/features/settings/SettingsController';
import { SUGGESTED_SYSTEMS } from '../../src/renderer/utils/suggested-systems';

const entry: LibraryEntry = {
  id: 'rom',
  source: '/roms',
  relativePath: 'game.nes',
  name: 'Game',
  system: 'NES',
  extension: '.nes',
  bytes: 42
};
const unexpected = async (): Promise<never> => assert.fail('Unexpected API call');

function metadataController() {
  return new MetadataController(
    {
      launchBoxSearch: unexpected,
      launchBoxApply: unexpected,
      downloadLaunchBox: unexpected,
      cancelLaunchBoxDownload: unexpected,
      importLaunchBox: unexpected,
      searchLibretroCovers: unexpected,
      metadataSave: unexpected,
      onLaunchBoxProgress: () => () => {}
    },
    entry,
    defaultSettings().metadata
  );
}

describe('Metadata editor state', () => {
  it('preserves unsaved changes for refreshed rows but resets when game identity changes', () => {
    const controller = metadataController();
    controller.set('title', 'Unsaved title');
    controller.setQuery('Search');
    controller.setCoverQuery('Cover search');
    controller.setSystemOverride('SNES');
    controller.selectCover('cover');
    const draft = controller.getSnapshot();
    controller.resetForNewGame({ ...entry, name: 'Refreshed row' });
    assert.equal(controller.getSnapshot(), draft);
    controller.resetForNewGame({ ...entry, relativePath: 'other.nes', name: 'Other game' });
    const state = controller.getSnapshot();
    assert.equal(state.form.title, 'Other game');
    assert.equal(state.form.artworkId, null);
    assert.equal(state.query, 'Other game');
    assert.equal(state.coverQuery, 'Other game');
    assert.equal(state.systemOverride, '');
  });

  it('saves manual edits, selected artwork, and a normalized system override', async () => {
    let saved: GameMetadataInput | undefined;
    let completed = 0;
    const controller = new MetadataController(
      {
        launchBoxSearch: unexpected,
        launchBoxApply: unexpected,
        downloadLaunchBox: unexpected,
        cancelLaunchBoxDownload: unexpected,
        importLaunchBox: unexpected,
        searchLibretroCovers: unexpected,
        metadataSave: async (target, input) => {
          assert.deepEqual(target, { source: entry.source, relativePath: entry.relativePath });
          saved = input;
          return { ...input, ...target };
        },
        onLaunchBoxProgress: () => () => {}
      },
      entry,
      defaultSettings().metadata
    );
    controller.set('title', 'Edited');
    controller.setSystemOverride(' SNES ');
    controller.selectCover('cover');
    await controller.save(entry, () => {
      completed++;
    });
    assert.equal(saved?.title, 'Edited');
    assert.equal(saved?.provider, 'manual');
    assert.equal(saved?.systemOverride, 'SNES');
    assert.equal(saved?.artworkId, 'cover');
    assert.equal(completed, 1);
    assert.equal(controller.getSnapshot().busy, false);
    assert.equal(controller.getSnapshot().error, '');
  });
});

describe('Settings draft', () => {
  it('edits independent preferences without mutating the original settings', () => {
    const initial = defaultSettings();
    const controller = new SettingsController(
      {
        getStorageInfo: unexpected,
        chooseExportFolder: unexpected,
        cleanupArtworkCache: unexpected,
        saveSettings: unexpected,
        resetSettings: unexpected
      },
      initial
    );
    controller.updateLibrary({ search: 'Mario', system: 'NES' });
    controller.changeCollection('/roms');
    controller.changeTheme('light');
    controller.changeArtwork(false);
    controller.clearDestination();
    controller.clearMappings();
    controller.changeMetadataStart('launchbox');
    controller.changeMetadataArtwork('saved-only');
    controller.requestReset();
    assert.equal(controller.getSnapshot().confirmReset, true);
    controller.cancelReset();
    const { draft, confirmReset } = controller.getSnapshot();
    assert.equal(confirmReset, false);
    assert.equal(draft.library.selected, '/roms');
    assert.equal(draft.library.search, '');
    assert.equal(draft.library.system, null);
    assert.equal(draft.appearance.theme, 'light');
    assert.equal(draft.export.includeArtwork, false);
    assert.equal(draft.export.destination, '');
    assert.deepEqual(draft.export.overrides, {});
    assert.equal(draft.metadata.startWith, 'launchbox');
    assert.equal(draft.metadata.artwork, 'saved-only');
    assert.deepEqual(initial, defaultSettings());
  });
});

it('offers unique, nonempty system suggestions including common supported platforms', () => {
  assert.equal(new Set(SUGGESTED_SYSTEMS).size, SUGGESTED_SYSTEMS.length);
  assert.ok(SUGGESTED_SYSTEMS.every((system) => system.trim().length > 0));
  assert.ok(SUGGESTED_SYSTEMS.includes('Nintendo Entertainment System'));
  assert.ok(SUGGESTED_SYSTEMS.includes('PlayStation'));
});
