import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { test } from 'node:test';
import { RendererJobs, sendProgress, type JobSender } from '../../src/main/ipc/renderer-jobs';
import {
  parseBulkSelection,
  parseCollection,
  parseLibraryQuery,
  parseSystemOverride
} from '../../src/main/ipc/library-validation';
import { isCollectionPath, isJobId, isOneOf, isRecord } from '../../src/main/ipc/validation';
import { parseExportOptions, parsePreviewFingerprint } from '../../src/main/ipc/export-validation';

class Sender extends EventEmitter implements JobSender {
  destroyed = false;
  readonly messages: Array<{ channel: string; args: unknown[] }> = [];

  constructor(readonly id: number) {
    super();
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  send(channel: string, ...args: unknown[]): void {
    this.messages.push({ channel, args });
  }

  destroy(): void {
    this.destroyed = true;
    this.emit('destroyed');
  }
}

function registry(): RendererJobs {
  return new RendererJobs({ busy: 'Job already running.', destroyed: 'Sender unavailable.' });
}

function waitForCancellation(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    function abort(): void {
      reject(Object.assign(new Error('Cancelled.'), { name: 'AbortError' }));
    }
    if (signal.aborted) {
      abort();
    } else {
      signal.addEventListener('abort', abort, { once: true });
    }
  });
}

test('renderer jobs reject overlap and cancellation belongs to the sender and job ID', async () => {
  const jobs = registry();
  const first = new Sender(1);
  const second = new Sender(2);
  const pending = jobs.run(first, 'scan', waitForCancellation);
  await assert.rejects(
    jobs.run(first, 'other', async () => 1),
    /already running/
  );
  assert.equal(await jobs.run(second, 'scan', async () => 2), 2);
  assert.equal(jobs.cancel(second.id, 'scan'), false);
  assert.equal(jobs.cancel(first.id, 'other'), false);
  assert.equal(jobs.cancel(first.id, 'scan'), true);
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(first.listenerCount('destroyed'), 0);
  assert.equal(jobs.cancel(first.id, 'scan'), false);
  assert.equal(await jobs.run(first, 'scan', async () => 3), 3);
});

test('renderer destruction aborts only its active job and suppresses progress', async () => {
  const jobs = registry();
  const first = new Sender(1);
  const second = new Sender(2);
  const a = jobs.run(first, 'job', waitForCancellation);
  const b = jobs.run(second, 'job', waitForCancellation);
  sendProgress(first, 'progress', { completed: 1 });
  first.destroy();
  await assert.rejects(a, { name: 'AbortError' });
  sendProgress(first, 'progress', { completed: 2 });
  assert.deepEqual(first.messages, [{ channel: 'progress', args: [{ completed: 1 }] }]);
  assert.equal(first.listenerCount('destroyed'), 0);
  assert.equal(jobs.cancel(second.id, 'job'), true);
  await assert.rejects(b, { name: 'AbortError' });
  assert.equal(second.listenerCount('destroyed'), 0);
  await assert.rejects(
    jobs.run(first, 'job', async () => 1),
    /Sender unavailable/
  );
});

test('renderer jobs release ownership after synchronous and asynchronous failure', async () => {
  const jobs = registry();
  const sender = new Sender(1);
  await assert.rejects(
    jobs.run(sender, 'a', () => {
      throw new Error('sync failure');
    }),
    /sync failure/
  );
  assert.equal(sender.listenerCount('destroyed'), 0);
  await assert.rejects(
    jobs.run(sender, 'b', async () => {
      throw new Error('async failure');
    }),
    /async failure/
  );
  assert.equal(sender.listenerCount('destroyed'), 0);
  assert.equal(await jobs.run(sender, 'c', async () => 'ok'), 'ok');
  assert.equal(sender.listenerCount('destroyed'), 0);
});

test('a sender destroyed during subscription cannot start work', async () => {
  class ClosingSender extends Sender {
    override once(event: string, listener: (...args: unknown[]) => void): this {
      super.once(event, listener);
      this.destroy();
      return this;
    }
  }
  const jobs = registry();
  const sender = new ClosingSender(1);
  let started = false;
  await assert.rejects(
    jobs.run(sender, 'a', async () => {
      started = true;
    }),
    { name: 'AbortError' }
  );
  assert.equal(started, false);
  assert.equal(sender.listenerCount('destroyed'), 0);
  assert.equal(jobs.cancel(sender.id, 'a'), false);
});

const filter = { source: null, search: '', system: null, identification: null };
const query = { ...filter, sort: 'name', descending: false, offset: 0, limit: 20 };

test('library query validation returns the public payload without unrelated properties', () => {
  assert.deepEqual(parseLibraryQuery({ ...query, unused: 123 }), query);
  const valid = { ...query, source: '/roms', identification: 'verified', sort: 'bytes', limit: 200 };
  assert.deepEqual(parseLibraryQuery(valid), valid);
  const { identification: _unused, ...legacyQuery } = query;
  assert.equal(parseLibraryQuery(legacyQuery).identification, undefined);
});

test('library query validation rejects malformed values instead of coercing them', () => {
  const invalid = [
    null,
    [],
    {},
    { ...query, sort: ['name'] },
    { ...query, sort: 'constructor' },
    { ...query, identification: ['verified'] },
    { ...query, descending: 0 },
    { ...query, offset: '0' },
    { ...query, offset: -1 },
    { ...query, offset: Number.MAX_SAFE_INTEGER + 1 },
    { ...query, limit: 0 },
    { ...query, limit: 201 },
    { ...query, limit: 1.5 },
    { ...query, search: 'x'.repeat(257) },
    { ...query, source: undefined }
  ];
  for (const value of invalid) {
    assert.throws(() => parseLibraryQuery(value), /Invalid library query/);
  }
});

test('bulk selection validation checks both discriminated payloads', () => {
  const target = { source: '/roms', relativePath: 'game.nes' };
  assert.deepEqual(parseBulkSelection({ scope: 'selected', targets: [target] }), {
    scope: 'selected',
    targets: [target]
  });
  assert.deepEqual(parseBulkSelection({ scope: 'filtered', filter }), { scope: 'filtered', filter });
  assert.deepEqual(parseBulkSelection({ scope: 'selected', targets: [] }), {
    scope: 'selected',
    targets: []
  });
  assert.deepEqual(parseBulkSelection({ scope: 'selected', targets: [{ ...target, unused: 1 }] }), {
    scope: 'selected',
    targets: [target]
  });
  assert.throws(() => parseBulkSelection({ scope: 'selected', targets: Array(1) }), /Invalid bulk selection/);
  assert.throws(
    () => parseBulkSelection({ scope: 'selected', targets: Array(5001).fill(target) }),
    /Too many selected ROMs/
  );
  for (const value of [
    null,
    { scope: 'selected' },
    { scope: 'selected', targets: [null] },
    { scope: 'selected', targets: [{ ...target, relativePath: '' }] },
    { scope: 'selected', targets: [{ ...target, source: 2 }] },
    { scope: 'filtered', filter: { ...filter, identification: 'bogus' } },
    { scope: ['filtered'], filter }
  ]) {
    assert.throws(() => parseBulkSelection(value), /Invalid bulk selection/);
  }
});

test('common IPC validators reject unsafe paths and invalid job IDs', () => {
  const root = path.resolve('roms');
  assert.equal(isCollectionPath(root), true);
  assert.equal(isCollectionPath(`${root}\0bad`), false);
  assert.equal(isCollectionPath('relative'), false);
  assert.equal(isCollectionPath(root + 'x'.repeat(4096)), false);
  assert.equal(isJobId('Scan_1-2'), true);
  assert.equal(isJobId(''), false);
  assert.equal(isJobId('x'.repeat(81)), false);
  assert.equal(isJobId('with spaces'), false);
  assert.equal(isRecord([]), false);
  assert.equal(isOneOf(['name'], ['name']), false);
  assert.equal(parseSystemOverride(null), null);
  assert.equal(parseSystemOverride('NES'), 'NES');
  assert.throws(() => parseSystemOverride(' '), /Invalid system/);
  assert.throws(() => parseSystemOverride('NES\n'), /Invalid system/);
  assert.equal(parseCollection(root), root);
  assert.throws(() => parseCollection(123), /Invalid collection/);
});

test('export request validation shares safe path checks and returns only approved fields', () => {
  const destination = path.resolve('export');
  const source = path.resolve('roms');
  const input = { destination, source, includeArtwork: true, overrides: { NES: 'nes' } };
  const result = parseExportOptions({ ...input, ignored: true });
  assert.equal(result.destination, destination);
  assert.equal(result.source, source);
  assert.equal(result.includeArtwork, true);
  assert.equal(Object.getPrototypeOf(result.overrides), null);
  assert.deepEqual({ ...result.overrides }, input.overrides);
  assert.equal(parseExportOptions({ ...input, source: null }).source, null);
  for (const value of [
    null,
    [],
    { ...input, destination: 'relative' },
    { ...input, destination: `${destination}\0bad` },
    { ...input, source: 'relative' },
    { ...input, includeArtwork: 1 },
    { ...input, overrides: [] }
  ]) {
    assert.throws(() => parseExportOptions(value), /Invalid export/);
  }
});

test('export request validation rejects prototype keys and unsafe system mappings', () => {
  const input = { source: null, destination: path.resolve('export'), includeArtwork: false };
  for (const overrides of [
    JSON.parse('{"__proto__":"nes"}'),
    { constructor: 'nes' },
    { prototype: 'nes' },
    { NES: '../nes' },
    { NES: 'UPPER' },
    { NES: 1 },
    { ['x'.repeat(257)]: 'nes' }
  ]) {
    assert.throws(() => parseExportOptions({ ...input, overrides }), /Invalid system mapping/);
  }
  assert.equal(parsePreviewFingerprint('a'.repeat(64)), 'a'.repeat(64));
  for (const value of [null, 'A'.repeat(64), 'a'.repeat(63), 'z'.repeat(64)]) {
    assert.throws(() => parsePreviewFingerprint(value), /Invalid preview confirmation/);
  }
});
