import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import { channels } from '../../src/ipc-channels';

const sourceRoot = path.resolve(__dirname, '../../../src');
const preloadRoot = path.join(sourceRoot, 'preload');
const entry = path.join(preloadRoot, 'preload.ts');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((item) => {
    const file = path.join(directory, item.name);
    return item.isDirectory() ? sourceFiles(file) : file.endsWith('.ts') ? [file] : [];
  });
}

test('preload modules depend only on shared contracts and other preload modules', () => {
  const allowed = [path.join(sourceRoot, 'shared'), path.join(sourceRoot, 'ipc-channels')];
  for (const file of sourceFiles(preloadRoot)) {
    const imports = ts.preProcessFile(readFileSync(file, 'utf8'), true, true).importedFiles;
    for (const item of imports) {
      if (item.fileName === 'electron' && file === entry) {
        continue;
      }
      assert.ok(item.fileName.startsWith('.'), `${file}: unexpected external dependency ${item.fileName}`);
      const target = path.resolve(path.dirname(file), item.fileName);
      assert.ok(
        allowed.includes(target) || target.startsWith(`${preloadRoot}${path.sep}`),
        `${file}: unexpected dependency ${item.fileName}`
      );
    }
  }
});

test('every desktop channel is registered exactly once by the backend using the shared definitions', () => {
  const mainRoot = path.join(sourceRoot, 'main');
  const files = [
    ...sourceFiles(path.join(mainRoot, 'ipc')).filter((file) => file.endsWith('-ipc.ts')),
    path.join(mainRoot, 'settings', 'settings-ipc.ts')
  ];
  const registered: string[] = [];
  for (const file of files) {
    const tree = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node)) {
        const name = node.expression.getText(tree);
        const index = name === 'ipcMain.handle' ? 0 : name === 'sendProgress' ? 1 : -1;
        if (index >= 0) {
          const argument = node.arguments[index];
          assert.ok(
            argument &&
              ts.isPropertyAccessExpression(argument) &&
              argument.expression.getText(tree) === 'channels',
            `${file}: use a shared channel definition`
          );
          registered.push(argument.name.text);
        }
      }
      node.forEachChild(visit);
    }
    visit(tree);
  }
  assert.deepEqual(registered.sort(), Object.keys(channels).sort());
  assert.equal(new Set(Object.values(channels)).size, Object.keys(channels).length);
});
