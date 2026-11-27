import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { createDesktopApi } from '../../src/preload/desktop-api';
import type { IpcTransport } from '../../src/preload/ipc/ipc-client';
import type { DesktopApi } from '../../src/shared';

class FakeTransport extends EventEmitter implements IpcTransport {
  readonly requests: { channel: string; args: unknown[] }[] = [];
  readonly response = { result: 'backend response' };

  async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    this.requests.push({ channel, args });
    return this.response;
  }
}

const requests: [keyof DesktopApi, string, unknown[]][] = [
  ['getSettings', 'settings:get', []],
  ['saveSettings', 'settings:save', ['patch']],
  ['resetSettings', 'settings:reset', []],
  ['getStorageInfo', 'settings:storage', []],
  ['cleanupArtworkCache', 'settings:cleanup-artwork', []],
  ['bulkAssignSystem', 'library:bulk-system', ['selection', 'systemOverride']],
  ['chooseExportFolder', 'export:choose', []],
  ['previewRetroPieExport', 'export:preview', ['options']],
  ['runRetroPieExport', 'export:run', ['options', 'fingerprint']],
  ['importLaunchBox', 'launchbox:import', []],
  ['downloadLaunchBox', 'launchbox:download', []],
  ['cancelLaunchBoxDownload', 'launchbox:cancel', []],
  ['launchBoxSearch', 'launchbox:search', ['query', 'system']],
  ['launchBoxApply', 'launchbox:apply', ['target', 'id']],
  ['findLibretroArtwork', 'libretro:artwork', ['system', 'names']],
  ['searchLibretroCovers', 'libretro:search-covers', ['system', 'query', 'regionHint', 'refresh']],
  ['metadataSave', 'metadata:save', ['target', 'data']],
  ['importDat', 'dat:import', []],
  ['identifyCollection', 'identity:run', ['source', 'jobId']],
  ['cancelIdentification', 'identity:cancel', ['jobId']],
  ['chooseRomFolder', 'roms:choose-folder', []],
  ['loadSavedLibrary', 'roms:load-saved', []],
  ['scanFolder', 'roms:scan', ['folder', 'jobId']],
  ['scanIndexedFolder', 'roms:scan-indexed', ['folder', 'jobId']],
  ['listCollections', 'library:collections', []],
  ['queryLibrary', 'library:query', ['query']],
  ['listSystems', 'library:systems', ['source']],
  ['renameCollection', 'library:rename', ['source', 'label']],
  ['removeCollection', 'library:remove', ['source']],
  ['cancelScan', 'roms:cancel', ['jobId']]
];

const progress: [keyof DesktopApi, string][] = [
  ['onLaunchBoxProgress', 'launchbox:progress'],
  ['onIdentificationProgress', 'identity:progress'],
  ['onScanProgress', 'roms:progress']
];

test('the bridge exposes exactly the existing desktop methods and forwards requests unchanged', async () => {
  const transport = new FakeTransport();
  const api = createDesktopApi(transport);
  const expected = [...requests, ...progress].map(([method]) => method).sort();
  assert.deepEqual(Object.keys(api).sort(), expected);
  for (const [method, channel, args] of requests) {
    assert.equal(await Reflect.apply(api[method], api, args), transport.response);
    assert.deepEqual(transport.requests.at(-1), { channel, args });
  }
});

test('progress subscriptions expose only payloads and unsubscribe only their own listener', () => {
  const transport = new FakeTransport();
  const api = createDesktopApi(transport);
  for (const [method, channel] of progress) {
    const received: unknown[][] = [];
    const listener = (...args: unknown[]) => received.push(args);
    const unsubscribe = Reflect.apply(api[method], api, [listener]);
    const other = Reflect.apply(api[method], api, [listener]);
    const payload = { completed: 1 };
    transport.emit(channel, { sender: 'private' }, payload);
    assert.deepEqual(received, [[payload], [payload]]);
    unsubscribe();
    transport.emit(channel, { sender: 'private' }, payload);
    assert.equal(received.length, 3);
    assert.equal(transport.listenerCount(channel), 1);
    other();
    assert.equal(transport.listenerCount(channel), 0);
  }
});
