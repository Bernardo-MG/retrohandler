import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { text } from 'node:stream/consumers';
import { test } from 'node:test';
import type { ArchiveFormatReader, ArchiveReader } from '../../src/main/components/archives/archive-reader';
import { archiveExtension } from '../../src/main/components/archives/archive-formats';
import { CompositeArchiveReader } from '../../src/main/components/archives/composite-archive-reader';

function backend(name: string, extensions: readonly string[], signal?: AbortSignal): ArchiveFormatReader {
  return {
    supports: async (filename, actualSignal) => {
      assert.equal(actualSignal, signal);
      return extensions.includes(archiveExtension(filename));
    },
    list: async (filename, actualSignal) => {
      assert.equal(actualSignal, signal);
      return [{ name: `${name}:${filename}`, size: 1, directory: false }];
    },
    open: async (filename, entryName, actualSignal) => {
      assert.equal(actualSignal, signal);
      assert.equal(entryName, `${name}:${filename}`);
      return Readable.from([name]);
    }
  };
}

test('composite readers route listing and opening by extension in configured priority order', async () => {
  const { signal } = new AbortController();
  const reader: ArchiveReader = new CompositeArchiveReader([
    backend('native', ['.zip'], signal),
    backend('external', ['.zip', '.rar', '.7z'], signal)
  ]);
  for (const [filename, expected] of [
    ['folder/game.ZIP', 'native'],
    ['folder/game.rar', 'external'],
    ['folder/game.7Z', 'external']
  ]) {
    const [entry] = await reader.list(filename, signal);
    assert.equal(entry.name, `${expected}:${filename}`);
    assert.equal(await text(await reader.open(filename, entry.name, signal)), expected);
  }
});

test('composite readers select the next backend only when a capability probe declines', async () => {
  const reader = new CompositeArchiveReader([
    {
      ...backend('native', ['.zip']),
      supports: async (filename) => filename === 'classic.zip'
    },
    backend('external', ['.zip'])
  ]);
  for (const [filename, expected] of [
    ['classic.zip', 'native'],
    ['variant.zip', 'external']
  ]) {
    const [entry] = await reader.list(filename);
    assert.equal(entry.name, `${expected}:${filename}`);
    assert.equal(await text(await reader.open(filename, entry.name)), expected);
  }
});

test('composite readers propagate probe and selected backend failures without retrying', async () => {
  const failure = new Error('Invalid archive.');
  const fallback: ArchiveFormatReader = {
    supports: async () => true,
    list: async () => assert.fail('Unexpected fallback listing'),
    open: async () => assert.fail('Unexpected fallback opening')
  };
  const rejectingProbe = new CompositeArchiveReader([
    {
      ...backend('native', ['.zip']),
      supports: async () => {
        throw failure;
      }
    },
    fallback
  ]);
  await assert.rejects(rejectingProbe.list('archive.zip'), (error) => error === failure);
  await assert.rejects(rejectingProbe.open('archive.zip', 'game.nes'), (error) => error === failure);
  const rejectingReader = new CompositeArchiveReader([
    {
      supports: async () => true,
      list: async () => {
        throw failure;
      },
      open: async () => {
        throw failure;
      }
    },
    fallback
  ]);
  await assert.rejects(rejectingReader.list('archive.zip'), (error) => error === failure);
  await assert.rejects(rejectingReader.open('archive.zip', 'game.nes'), (error) => error === failure);
});

test('composite readers reject unsupported formats and already cancelled requests', async () => {
  const reader = new CompositeArchiveReader([backend('native', ['.zip'])]);
  await assert.rejects(reader.list('archive.txt'), /Unsupported archive format: \.txt/);
  await assert.rejects(reader.open('archive', 'game.nes'), /Unsupported archive format: \(no extension\)/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(reader.list('archive.zip', controller.signal), { name: 'AbortError' });
  await assert.rejects(reader.open('archive.zip', 'game.nes', controller.signal), { name: 'AbortError' });
});

test('composite readers do not start a backend when cancelled during a capability probe', async () => {
  const controller = new AbortController();
  const reader = new CompositeArchiveReader([
    {
      supports: async (_filename, signal) => {
        assert.equal(signal, controller.signal);
        controller.abort();
        return true;
      },
      list: async () => assert.fail('Unexpected listing'),
      open: async () => assert.fail('Unexpected opening')
    }
  ]);
  await assert.rejects(reader.list('archive.zip', controller.signal), { name: 'AbortError' });
});
