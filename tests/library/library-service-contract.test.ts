import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FileSystemLibraryService } from '../../src/main/services/library';
import type { BulkSystemSelection, CollectionInfo, LibraryQuery } from '../../src/shared';

const source = '/roms';
const query: LibraryQuery = {
  source,
  search: 'Mario',
  system: 'NES',
  sort: 'name',
  descending: false,
  offset: 0,
  limit: 50
};
const selection: BulkSystemSelection = { scope: 'selected', targets: [{ source, relativePath: 'game.nes' }] };

describe('Library service repository contracts', () => {
  it('delegates collection reads, library queries, and system counts', async () => {
    const collections: CollectionInfo[] = [
      { rootPath: source, label: 'Games', scannedAt: '', gameCount: 1, ignored: 0, warningCount: 0 }
    ];
    const page = { items: [], total: 0 };
    const systems = [{ system: 'NES', count: 1 }];
    const service = new FileSystemLibraryService({
      collections: {
        saveScan: () => assert.fail('Unexpected scan'),
        loadLastScan: () => null,
        listCollections: () => collections
      },
      roms: {
        queryLibrary: (actual) => {
          assert.deepEqual(actual, query);
          return page;
        },
        listSystems: (actual) => {
          assert.equal(actual, source);
          return systems;
        }
      }
    });
    assert.deepEqual(await service.listCollections(), collections);
    assert.deepEqual(await service.queryLibrary(query), page);
    assert.deepEqual(await service.listSystems(source), systems);
  });

  it('passes collection and system mutations to the appropriate repository', async () => {
    const calls: unknown[][] = [];
    const service = new FileSystemLibraryService({
      collections: {
        saveScan: () => assert.fail('Unexpected scan'),
        loadLastScan: () => null,
        renameCollection: (...args) => {
          calls.push(['rename', ...args]);
        },
        removeCollection: (...args) => {
          calls.push(['remove', ...args]);
        }
      },
      systemOverrides: {
        bulkAssignSystem: (...args) => {
          calls.push(['assign', ...args]);
          return 1;
        }
      }
    });
    await service.renameCollection(source, 'Renamed');
    assert.equal(await service.bulkAssignSystem(selection, 'SNES'), 1);
    await service.removeCollection(source);
    assert.deepEqual(calls, [
      ['rename', source, 'Renamed'],
      ['assign', selection, 'SNES'],
      ['remove', source]
    ]);
  });

  it('returns empty reads but rejects mutations when repositories are unavailable', async () => {
    const service = new FileSystemLibraryService();
    assert.deepEqual(await service.listCollections(), []);
    assert.deepEqual(await service.queryLibrary(query), { items: [], total: 0 });
    assert.deepEqual(await service.listSystems(null), []);
    await assert.rejects(service.renameCollection(source, 'Renamed'), /Collection storage unavailable/);
    await assert.rejects(service.removeCollection(source), /Collection storage unavailable/);
    await assert.rejects(service.bulkAssignSystem(selection, null), /Bulk system assignment unavailable/);
  });
});
