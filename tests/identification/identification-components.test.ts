import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rename, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
import type { IdentificationRepository } from '../../src/main/contracts/persistence';
import type { ArchiveReader } from '../../src/main/components/archives/archive-reader';
import { SevenZipReader } from '../../src/main/components/archives/seven-zip-reader';
import { FingerprintReader } from '../../src/main/components/hashing/fingerprint-reader';
import { matchFingerprintCandidates } from '../../src/main/identification/fingerprint-matcher';
import { RomSource } from '../../src/main/identification/rom/rom-source';
import type { IdentificationResult, LibraryEntry } from '../../src/shared';
import { identificationService } from '../helpers/identification';

const data = Buffer.from('123456789');
const emptyArchive: ArchiveReader = { list: async () => [], open: () => Readable.from([]) };
const reader = new FingerprintReader();

function entry(source: string, relativePath: string): LibraryEntry {
  return {
    id: relativePath,
    name: relativePath,
    system: 'NES',
    source,
    relativePath,
    extension: path.extname(relativePath),
    bytes: data.length
  };
}

function repository(entries: LibraryEntry[]) {
  const commits: IdentificationResult[][] = [];
  const store: IdentificationRepository = {
    importDat: (dat) => ({ name: dat.name, count: dat.entries.length }),
    entriesForIdentification: (source) => entries.filter((item) => item.source === source),
    cachedFingerprint: () => null,
    matchFingerprint: () => ({ status: 'verified', title: 'Test game', datName: 'DAT' }),
    saveIdentification: (_source, results) => {
      commits.push([...results]);
    }
  };
  return { store, commits };
}

async function temporary(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rh-identification-component-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('direct file reader returns the exact streaming hashes and rejects nonregular inputs', async () =>
  temporary(async (root) => {
    const file = path.join(root, 'game.nes');
    await writeFile(file, data);
    const hashes = await reader.readFile(file);
    assert.equal(hashes.crc32, 'cbf43926');
    assert.equal(hashes.sha1, createHash('sha1').update(data).digest('hex'));
    assert.equal(hashes.md5, createHash('md5').update(data).digest('hex'));
    assert.equal(hashes.size, data.length);
    await assert.rejects(reader.readFile(root), /regular file/);
  }));

test('an idle fingerprint stream is cancelled without waiting for another chunk', async () => {
  const controller = new AbortController();
  const stream = new PassThrough();
  const pending = reader.readStream(stream, 1, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(stream.destroyed, true);
});

test('the fingerprint matcher preserves priority and ambiguity rules', () => {
  const crc = { game: 'CRC game', datName: 'DAT', evidence: 'crc' };
  const md5 = { game: 'MD5 game', datName: 'DAT', evidence: 'md5' };
  const sha1 = { game: 'SHA game', datName: 'DAT', evidence: 'sha1' };
  assert.deepEqual(matchFingerprintCandidates([]), { status: 'unknown', title: null, datName: null });
  assert.equal(matchFingerprintCandidates([crc]).status, 'probable');
  assert.equal(matchFingerprintCandidates([crc, md5]).title, 'MD5 game');
  assert.equal(matchFingerprintCandidates([md5, crc, sha1]).title, 'SHA game');
  assert.equal(matchFingerprintCandidates([sha1, { ...sha1, datName: 'Other DAT' }]).status, 'verified');
  assert.equal(matchFingerprintCandidates([sha1, { ...sha1, game: 'Conflict' }]).status, 'ambiguous');
});

test('source containment works even when the collection is a filesystem root', async () =>
  temporary(async (root) => {
    const file = path.join(root, 'game.nes');
    await writeFile(file, data);
    const source = path.parse(root).root;
    const target = { source, relativePath: path.relative(source, file), extension: '.nes' };
    const resolved = await RomSource.resolve(target);
    assert.equal(resolved.filename, file);
    await assert.rejects(
      RomSource.resolve({ source: root, relativePath: '../outside.nes', extension: '.nes' }),
      /outside collection/
    );
  }));

test('source validation rejects a replacement with the same size and mtime', async () =>
  temporary(async (root) => {
    const file = path.join(root, 'game.nes');
    const replacement = path.join(root, 'replacement');
    await writeFile(file, data);
    const original = await RomSource.resolve({ source: root, relativePath: 'game.nes', extension: '.nes' });
    await writeFile(replacement, Buffer.alloc(data.length));
    await utimes(replacement, original.stats.atime, original.stats.mtime);
    await rename(replacement, file);
    await assert.rejects(original.assertUnchanged(), /changed during identification/);
  }));

test('source validation rejects links escaping the collection', async (t) =>
  temporary(async (root) => {
    const outside = path.join(root, 'outside.nes');
    const collection = path.join(root, 'collection');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(collection);
    await writeFile(outside, data);
    try {
      await symlink(outside, path.join(collection, 'linked.nes'), 'file');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') {
        t.skip('Symbolic links are unavailable.');
        return;
      }
      throw error;
    }
    await assert.rejects(
      RomSource.resolve({ source: collection, relativePath: 'linked.nes', extension: '.nes' }),
      /regular file/
    );
  }));

test('identification keeps the existing cache and progress behavior', async () =>
  temporary(async (root) => {
    const files = Array.from({ length: 11 }, (_, i) => entry(root, `game${i}.nes`));
    for (const file of files) {
      await writeFile(path.join(root, file.relativePath), data);
    }
    const { store, commits } = repository(files);
    let cacheReads = 0;
    store.cachedFingerprint = (_source, _relative, size, modifiedMs) => {
      cacheReads++;
      return { crc32: 'cbf43926', md5: 'm', sha1: 's', size, modifiedMs };
    };
    const progress: number[] = [];
    const receipt = await identificationService(store, emptyArchive).identifyCollection(root, {
      onProgress: (update) => progress.push(update.processed)
    });
    assert.equal(cacheReads, 11);
    assert.equal(receipt.verified, 11);
    assert.deepEqual(progress, [10, 11]);
    assert.equal(commits.length, 1);
    assert.equal(commits[0].length, 11);
    assert.ok(commits[0].every((result) => result.fingerprint?.sha1 === 's'));
  }));

test('a collection lock rejects overlapping jobs and is released on completion', async () =>
  temporary(async (root) => {
    await writeFile(path.join(root, 'game.zip'), 'archive');
    const { store, commits } = repository([entry(root, 'game.zip')]);
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const archive: ArchiveReader = {
      async list() {
        enter();
        await pending;
        return [];
      },
      open: () => Readable.from([])
    };
    const service = identificationService(store, archive);
    const first = service.identifyCollection(root);
    await entered;
    try {
      await assert.rejects(service.identifyCollection(root), /already running/);
    } finally {
      release();
    }
    assert.equal((await first).unsupported, 1);
    assert.equal((await service.identifyCollection(root)).unsupported, 1);
    assert.equal(commits.length, 2);
  }));

test('cancellation at final progress saves nothing and releases the collection lock', async () =>
  temporary(async (root) => {
    await writeFile(path.join(root, 'game.nes'), data);
    const { store, commits } = repository([entry(root, 'game.nes')]);
    const controller = new AbortController();
    const service = identificationService(store, emptyArchive);
    await assert.rejects(
      service.identifyCollection(root, {
        signal: controller.signal,
        onProgress: () => controller.abort()
      }),
      { name: 'AbortError' }
    );
    assert.equal(commits.length, 0);
    assert.equal((await service.identifyCollection(root)).verified, 1);
    assert.equal(commits.length, 1);
  }));

test('archive replacement is refused before a member is opened', async () =>
  temporary(async (root) => {
    const file = path.join(root, 'game.zip');
    await writeFile(file, data);
    const { store, commits } = repository([entry(root, 'game.zip')]);
    let opened = false;
    const archive: ArchiveReader = {
      async list() {
        await writeFile(file, Buffer.from('changed archive'));
        return [{ name: 'game.nes', size: data.length, directory: false }];
      },
      open() {
        opened = true;
        return Readable.from([data]);
      }
    };
    const result = await identificationService(store, archive).identifyCollection(root);
    assert.equal(result.errors, 1);
    assert.equal(opened, false);
    assert.equal(commits[0][0].fingerprint, null);
  }));

test('DAT importing reads and validates the catalogue before calling the repository', async () =>
  temporary(async (root) => {
    const { store } = repository([]);
    const service = identificationService(store, emptyArchive);
    const file = path.join(root, 'catalogue.dat');
    await writeFile(
      file,
      '<datafile><game name="Test"><rom name="test.nes" size="9" crc="cbf43926"/></game></datafile>'
    );
    assert.deepEqual(await service.importDat(file), { name: 'Imported DAT', count: 1 });
    await writeFile(file, '<!DOCTYPE datafile><datafile/>');
    await assert.rejects(service.importDat(file), /DTD/);
  }));

test('missing 7-Zip executable reports both listing and extraction errors', async () =>
  temporary(async (root) => {
    const archive = new SevenZipReader(path.join(root, 'nonexistent-executable'));
    await assert.rejects(archive.list('test.zip'), /ENOENT/);
    const stream = archive.open('test.zip', 'game.nes');
    await assert.rejects(reader.readStream(stream, data.length), /ENOENT/);
  }));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((item) => {
    const filename = path.join(directory, item.name);
    return item.isDirectory() ? sourceFiles(filename) : item.name.endsWith('.ts') ? [filename] : [];
  });
}

function imports(file: string): string[] {
  return ts.preProcessFile(readFileSync(file, 'utf8'), true, true).importedFiles.map((item) => item.fileName);
}

test('identification and its reusable components do not import Electron, IPC or database internals', () => {
  const mainRoot = path.resolve(__dirname, '../../../src/main');
  const domain = path.join(mainRoot, 'identification');
  const components = path.join(mainRoot, 'components');
  const domainFiles = sourceFiles(domain);
  const componentFiles = ['archives', 'hashing', 'async'].flatMap((folder) =>
    sourceFiles(path.join(components, folder))
  );
  for (const file of [...domainFiles, ...componentFiles]) {
    for (const reference of imports(file)) {
      assert.notEqual(reference, 'electron', file);
      if (!reference.startsWith('.')) {
        continue;
      }
      const target = path.resolve(path.dirname(file), reference);
      assert.ok(!target.startsWith(path.join(mainRoot, 'database') + path.sep), `${file}: ${reference}`);
      assert.ok(!target.startsWith(path.join(mainRoot, 'ipc') + path.sep), `${file}: ${reference}`);
      if (componentFiles.includes(file)) {
        assert.ok(target.startsWith(components + path.sep), `${file}: ${reference}`);
      }
    }
  }
});
