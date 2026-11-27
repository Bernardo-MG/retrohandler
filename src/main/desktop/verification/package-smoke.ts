import { app } from 'electron';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import { createCore } from '../composition';
import { verifyPackagedRenderer } from './renderer-verifier';

async function runPackageSmoke(root: string): Promise<void> {
  const core = createCore(root);
  try {
    await core.library.listCollections();
    await verifyPackagedRenderer();
  } finally {
    core.database.close();
  }
  app.exit(0);
}

export function preparePackageSmoke(failStartup: (error: unknown) => void): void {
  // Never open or migrate the real library during release verification.
  const temp = mkdtempSync(path.join(os.tmpdir(), 'retrohandler-package-'));
  app.setPath('userData', temp);
  app.setPath('sessionData', temp);
  process.once('exit', () => {
    try {
      rmSync(temp, { recursive: true, force: true });
    } catch {
      /* Windows may still hold Chromium files. */
    }
  });
  app
    .whenReady()
    .then(() => runPackageSmoke(temp))
    .catch(failStartup);
}
