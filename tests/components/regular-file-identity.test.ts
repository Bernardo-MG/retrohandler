import assert from 'node:assert/strict';
import { mkdtemp, realpath, rename, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { RegularFileIdentity } from '../../src/main/components/filesystem/regular-file-identity';

async function fixture(run: (filename: string, folder: string) => Promise<void>): Promise<void> {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'rh-file-identity-'));
  try {
    const filename = path.join(folder, 'file');
    await writeFile(filename, 'original');
    await run(filename, folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

test('regular file identity records the canonical path and rejects nonregular files', async () =>
  fixture(async (filename, folder) => {
    const identity = await RegularFileIdentity.observe(filename);
    assert.equal(identity.filename, filename);
    assert.equal(identity.canonicalFilename, await realpath(filename));
    assert.equal(identity.stats.size, 8);
    await identity.assertUnchanged();
    await assert.rejects(RegularFileIdentity.observe(folder), /regular file/);
  }));

test('regular file identity rejects a replacement even if size and mtime match', async () =>
  fixture(async (filename, folder) => {
    const identity = await RegularFileIdentity.observe(filename);
    const replacement = path.join(folder, 'replacement');
    await writeFile(replacement, 'replaced');
    await utimes(replacement, identity.stats.atime, identity.stats.mtime);
    await rename(replacement, filename);
    await assert.rejects(identity.assertUnchanged(), /File changed/);
  }));

test('regular file identity rejects a file link', { skip: process.platform === 'win32' }, async () =>
  fixture(async (filename, folder) => {
    const link = path.join(folder, 'link');
    await symlink(filename, link);
    await assert.rejects(RegularFileIdentity.observe(link), /regular file/);
  }));
