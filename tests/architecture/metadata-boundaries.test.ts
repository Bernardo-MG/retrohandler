import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

test('metadata service does not depend on concrete metadata providers', () => {
  const file = path.resolve(__dirname, '../../../src/main/metadata/metadata-service.ts');
  const imports = ts.preProcessFile(readFileSync(file, 'utf8'), true, true).importedFiles;
  assert.deepEqual(
    imports.map((item) => item.fileName).filter((reference) => /(?:launchbox|libretro)\//.test(reference)),
    []
  );
});
