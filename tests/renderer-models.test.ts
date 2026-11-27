import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultSettings, type CollectionInfo, type ExportPlan, type LibraryEntry, type LibraryPreferences } from '../src/shared';
import {
  collectionPreferences, collectionSystemSelection, latestDetails, libraryQuery, libraryStatistics, pagination, samePreferences
} from '../src/renderer/features/library/library-model';
import { initialMetadata, cleanTitle, launchBoxProgress, manualMetadata } from '../src/renderer/features/metadata/metadata-model';
import { mappingRows, normalizedOverrides, summarizePlan, validPreferences } from '../src/renderer/features/export/export-model';
import { formatBytes, formatSize } from '../src/renderer/utils/format-size';

const preferences: LibraryPreferences = {
  selected: 'C:/roms', search: 'mario', system: 'NES', sort: 'bytes', descending: true,
  identification: 'verified', view: 'grid'
};

function collection(rootPath: string, gameCount: number): CollectionInfo {
  return { rootPath, label: rootPath, gameCount, scannedAt: '2026-01-01', ignored: 0, warningCount: 0 };
}
function game(source = 'C:/roms', relativePath = 'game.nes'): LibraryEntry {
  return { id: 'game', source, relativePath, name: 'Example (USA) [!]', system: 'NES', extension: '.nes', bytes: 42 };
}

test('changing collections clears collection-specific filters but retains sort and view', () => {
  const changed = collectionPreferences(preferences, 'D:/games');
  assert.deepEqual(changed, {
    selected: 'D:/games', search: '', system: null, sort: 'bytes', descending: true, identification: null, view: 'grid'
  });
  assert.equal(preferences.search, 'mario');
  assert.equal(samePreferences(preferences, { ...preferences }), true);
  assert.equal(samePreferences(preferences, changed), false);
  assert.equal(samePreferences(preferences, { ...preferences, view: 'list' }), false);
});

test('library query uses the debounced search and does not send view preferences', () => {
  assert.deepEqual(libraryQuery(preferences, 'mar', 100), {
    source: 'C:/roms', search: 'mar', system: 'NES', sort: 'bytes', descending: true,
    identification: 'verified', offset: 100, limit: 100
  });
});

test('bulk collection assignment is not affected by current filters or pagination', () => {
  assert.deepEqual(collectionSystemSelection('C:/roms'), {
    scope: 'filtered', filter: { source: 'C:/roms', search: '', system: null, identification: null }
  });
});

test('library statistics retain selection totals and inferred-platform percentage', () => {
  const collections = [collection('C:/roms', 4), collection('D:/games', 10)];
  const systems = [{ system: 'NES', count: 3 }, { system: 'Needs identification', count: 1 }];
  assert.deepEqual(libraryStatistics(collections, systems, 'C:/roms'), {
    totalGames: 14, selectedCount: 4, platformTotal: 2, identifiedPercent: '75%'
  });
  assert.deepEqual(libraryStatistics([], [], null), {
    totalGames: 0, selectedCount: 0, platformTotal: 0, identifiedPercent: '—'
  });
});

test('metadata details refresh by full collection and relative-path identity', () => {
  const selected = game();
  const updated = { ...selected, name: 'Updated' };
  const other = { ...game('D:/games'), name: 'Other collection' };
  assert.equal(latestDetails({ items: [other, updated], total: 2 }, selected), updated);
  assert.equal(latestDetails({ items: [other], total: 1 }, selected), selected);
  assert.equal(latestDetails({ items: [], total: 0 }, null), null);
});

test('table and gallery share correct empty, partial-page and loading pagination', () => {
  assert.deepEqual(pagination(0, 0, 100, false), {
    range: '0', previousOffset: 0, nextOffset: 100, previousDisabled: true, nextDisabled: true
  });
  assert.deepEqual(pagination(125, 100, 100, false), {
    range: '101–125', previousOffset: 0, nextOffset: 200, previousDisabled: false, nextDisabled: true
  });
  assert.equal(pagination(250, 100, 100, true).previousDisabled, true);
  assert.equal(pagination(250, 100, 100, true).nextDisabled, true);
  assert.equal(pagination(250, 100, 100, false).nextDisabled, false);
});

test('metadata starts from existing data or identified title and cleans search titles', () => {
  const entry = { ...game(), identifiedTitle: 'Matched (USA) [!]' };
  assert.equal(initialMetadata(entry).title, 'Matched (USA) [!]');
  assert.equal(cleanTitle(entry), 'Matched');
  const metadata = { ...initialMetadata(entry), source: entry.source, relativePath: entry.relativePath, title: 'Saved' };
  assert.equal(initialMetadata({ ...entry, metadata }), metadata);
});

test('manual metadata preserves artwork and clears provider match details', () => {
  const existing = { ...initialMetadata(game()), provider: 'launchbox' as const, providerId: '4', providerSlug: 'example', artworkId: 'cover.png' };
  const result = manualMetadata(existing, '  NES  ');
  assert.equal(result.artworkId, 'cover.png');
  assert.equal(result.provider, 'manual');
  assert.equal(result.providerId, null);
  assert.equal(result.providerSlug, null);
  assert.equal(result.systemOverride, 'NES');
  assert.equal(manualMetadata(existing, ' ').systemOverride, null);
  assert.equal(existing.provider, 'launchbox');
});

test('LaunchBox progress text distinguishes downloading, extraction and importing', () => {
  assert.equal(launchBoxProgress(null), '');
  assert.equal(launchBoxProgress({ phase: 'download', processed: 1048576, total: 2097152 }), 'Downloading 1.0 MiB / 2.0 MiB');
  assert.equal(launchBoxProgress({ phase: 'extract', processed: 524288, total: null }), 'Extracting 0.5 MiB');
  assert.equal(launchBoxProgress({ phase: 'import', processed: 42, total: null }), 'Importing 42 games…');
});

test('export preferences drop empty overrides and reject unsafe or incomplete edits', () => {
  const initial = defaultSettings().export;
  const value = { ...initial, overrides: { NES: 'nes', SNES: '' } };
  assert.deepEqual(normalizedOverrides(value.overrides), { NES: 'nes' });
  assert.deepEqual(validPreferences(value), { ...initial, overrides: { NES: 'nes' } });
  for (const invalid of ['../nes', 'NES', 'con', 'a b']) {
    assert.equal(validPreferences({ ...initial, overrides: { NES: invalid } }), null);
  }
  assert.equal(validPreferences({ ...initial, overrides: { ['__proto__']: 'nes' } }), null);
});

test('system mapping respects empty draft edits, overrides and default mappings', () => {
  assert.deepEqual(mappingRows(['Nintendo Entertainment System', 'Super Nintendo', 'constructor', 'Unknown'], {
    'Super Nintendo': 'custom', Unknown: ''
  }), [
    { system: 'Nintendo Entertainment System', folder: 'nes' },
    { system: 'Super Nintendo', folder: 'custom' },
    { system: 'constructor', folder: '' },
    { system: 'Unknown', folder: '' }
  ]);
});

test('export preview counts only files being written and blocks conflicts or empty ROM selections', () => {
  const plan: ExportPlan = {
    destination: 'D:/retropie', systems: ['nes'], skippedRoms: 1, bytes: 0, fingerprint: 'fingerprint', warnings: [], conflicts: [],
    files: [
      { source: 'rom', relativeDestination: 'roms/nes/game.nes', size: 9000000, kind: 'rom' },
      { source: 'xml', relativeDestination: 'roms/nes/gamelist.xml', size: 524288, kind: 'gamelist', action: 'update' },
      { source: 'art', relativeDestination: 'roms/nes/images/new.png', size: 524288, kind: 'artwork', action: 'create' },
      { source: 'art', relativeDestination: 'roms/nes/images/old.png', size: 999, kind: 'artwork', action: 'reuse' }
    ]
  };
  assert.deepEqual(summarizePlan(plan), {
    references: 1, created: 1, updated: 1, reused: 1, writtenFiles: plan.files.slice(1, 3), mibToWrite: '1.00', canGenerate: true
  });
  assert.equal(summarizePlan({ ...plan, conflicts: ['conflict'] }).canGenerate, false);
  assert.equal(summarizePlan({ ...plan, files: plan.files.slice(1) }).canGenerate, false);
});

test('display formatting preserves existing library and settings units', () => {
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1073741824), '1.00 GB');
  assert.equal(formatSize(1024), '1.0 KiB');
  assert.equal(formatSize(1048576), '1.00 MiB');
});
