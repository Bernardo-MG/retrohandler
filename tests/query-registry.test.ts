import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { PreparedStatements, QueryRegistry, createCoreQueryRegistry } from '../src/main/database/query-loader';
import type { DatabaseHandle, Statement } from '../src/main/database/types';

function fixture(run: (file: (name: string, contents: string) => string) => void) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'retrohandler-queries-'));
  try {
    run((name, contents) => {
      const filename = path.join(root, name);
      writeFileSync(filename, contents);
      return filename;
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('independent namespaces need no core name registration', () => fixture((file) => {
  const registry = new QueryRegistry();
  const catalog = file('extension.sql', '-- name: find\r\nSELECT ? AS value;\r\n');
  registry.load('extension-one', catalog);
  registry.load('extension-two', catalog);
  assert.equal(registry.sql('extension-one.find'), 'SELECT ? AS value;');
  assert.equal(registry.sql('extension-two.find'), 'SELECT ? AS value;');
  assert.throws(() => registry.sql('extension-three.find'), /Unknown SQL statement/);
  assert.throws(() => new QueryRegistry().sql('extension-one.find'), /Unknown SQL statement/);
}));

test('duplicate registration fails atomically without changing existing definitions', () => fixture((file) => {
  const registry = new QueryRegistry();
  registry.load('plugin', file('first.sql', '-- name: existing\nSELECT 1;'));
  assert.throws(() => registry.load('plugin', file('second.sql', '-- name: newQuery\nSELECT 2;\n-- name: existing\nSELECT 3;')), /duplicate/);
  assert.equal(registry.sql('plugin.existing'), 'SELECT 1;');
  assert.throws(() => registry.sql('plugin.newQuery'), /Unknown SQL statement/);
  assert.throws(() => registry.load('plugin', file('duplicate.sql', '-- name: same\nSELECT 1;\n-- name: same\nSELECT 2;')), /duplicate/);
  assert.throws(() => registry.sql('plugin.same'), /Unknown SQL statement/);
}));

test('registry validates namespaces, empty catalogs and templates', () => fixture((file) => {
  const registry = new QueryRegistry();
  const catalog = file('template.sql', '-- name: select\nSELECT {{column}};');
  assert.throws(() => registry.load('bad.namespace', catalog), /Invalid SQL namespace/);
  assert.throws(() => registry.load('plugin', file('empty.sql', '-- name: empty\n')), /Invalid or duplicate/);
  registry.load('plugin', catalog);
  assert.equal(registry.render('plugin.select', { column: '1' }), 'SELECT 1;');
  assert.throws(() => registry.render('plugin.select', {}), /Missing SQL fragment/);
  assert.throws(() => registry.render('plugin.select', { column: '1', extra: '2' }), /Invalid SQL template/);
}));

test('prepared statements are cached per connection and use bound parameters', () => fixture((file) => {
  const registry = new QueryRegistry();
  registry.load('plugin', file('plugin.sql', '-- name: echo\nSELECT ? AS value;'));
  const first = new DatabaseSync(':memory:');
  const second = new DatabaseSync(':memory:');
  try {
    const adapter = (db: DatabaseSync): DatabaseHandle => ({
      pragma: (sql) => db.exec(`PRAGMA ${sql}`),
      exec: (sql) => db.exec(sql),
      prepare: (sql) => db.prepare(sql) as Statement,
      transaction: (fn) => fn,
      close: () => db.close()
    });
    const a = new PreparedStatements(adapter(first), registry);
    const b = new PreparedStatements(adapter(second), registry);
    assert.equal(a.get('plugin.echo'), a.get('plugin.echo'));
    assert.notEqual(a.get('plugin.echo'), b.get('plugin.echo'));
    assert.equal((a.get('plugin.echo').get("' OR 1=1") as { value: string }).value, "' OR 1=1");
  } finally {
    first.close();
    second.close();
  }
}));

test('built-in catalogs are discovered from packaged SQL resources', () => {
  const registry = createCoreQueryRegistry();
  assert.match(registry.sql('metadata.getArtworkId'), /SELECT/i);
  assert.throws(() => registry.sql('legacy.addCollectionLabel'), /Unknown SQL statement/);
  assert.match(registry.sql('schema.readVersion'), /PRAGMA user_version/i);
});
