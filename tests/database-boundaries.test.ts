import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

const root = path.resolve(__dirname, '../../src');
const databaseRoot = path.join(root, 'main', 'database');
const compositionRoot = path.join(root, 'main', 'main.ts');

function inside(directory: string, filename: string): boolean {
  const relative = path.relative(directory, filename);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function moduleReferences(filename: string, contents: string): string[] {
  const source = ts.createSourceFile(filename, contents, ts.ScriptTarget.Latest, true);
  const references: string[] = [];
  function add(node: ts.Node | undefined): void {
    if (node && ts.isStringLiteralLike(node)) references.push(node.text);
  }
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    if (ts.isExternalModuleReference(node)) add(node.expression);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) add(node.argument.literal);
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
        add(node.arguments[0]);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return references;
}

function violations(filename: string, contents: string): string[] {
  if (inside(databaseRoot, filename)) return [];
  return moduleReferences(filename, contents).filter(reference => {
    if (/^(?:better-sqlite3|sqlite3|node:sqlite)(?:\/|$)/.test(reference)) return true;
    if (!reference.startsWith('.')) return false;
    const destination = path.resolve(path.dirname(filename), reference);
    if (!inside(databaseRoot, destination)) return false;
    // Only the application composition root imports the database package's public entry point.
    return filename !== compositionRoot || destination !== databaseRoot;
  });
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(filename);
    return /\.(?:[cm]?[jt]s|[jt]sx)$/.test(entry.name) ? [filename] : [];
  });
}

test('database access and internal imports are confined to the database package', () => {
  const files = sourceFiles(root);
  assert.ok(files.includes(compositionRoot));
  assert.ok(files.some(file => inside(databaseRoot, file)));
  const issues = files.flatMap(file => violations(file, readFileSync(file, 'utf8')).map(ref => `${path.relative(root, file)}: ${ref}`));
  assert.deepEqual(issues, [], 'Only main.ts may import the public database package; other modules must use persistence contracts.');
});

test('boundary checker catches type imports, dynamic imports and native driver requirements', () => {
  const file = path.join(root, 'main', 'settings', 'example.ts');
  assert.deepEqual(violations(file, `
    import type { DatabaseHandle } from '../database/sql/types';
    const db = require('better-sqlite3');
    const registry = import('../database/sql/query-registry');
    export type T = import('../database/sql/types').Statement;
    import type { ArtworkReferences } from '../contracts/persistence';
  `), ['../database/sql/types', 'better-sqlite3', '../database/sql/query-registry', '../database/sql/types']);
  assert.deepEqual(violations(compositionRoot, "import { openDatabase } from './database';"), []);
  assert.deepEqual(violations(compositionRoot, "import { openDatabase } from './database/database-connection';"), ['./database/database-connection']);
});
