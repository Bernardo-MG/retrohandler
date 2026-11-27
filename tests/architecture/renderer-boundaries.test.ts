import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

const root = path.resolve(__dirname, '../../../src/renderer');
const api = path.join(root, 'api', 'desktop-api.ts');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : /\.tsx?$/.test(file) ? [file] : [];
  });
}

function source(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
}

function imports(file: string): string[] {
  return ts.preProcessFile(readFileSync(file, 'utf8'), true, true).importedFiles.map((item) => item.fileName);
}

function inside(directory: string, target: string): boolean {
  const relative = path.relative(directory, target);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}

function visit(node: ts.Node, inspect: (node: ts.Node) => void): void {
  inspect(node);
  node.forEachChild((child) => visit(child, inspect));
}

function referenceName(file: string, detail: string): string {
  return `${path.relative(root, file)}: ${detail}`;
}

test('renderer code reaches the preload bridge only through the dedicated API module', () => {
  const violations: string[] = [];
  for (const file of sourceFiles(root)) {
    if (
      file !== api &&
      !file.endsWith('.d.ts') &&
      /\bwindow\s*(?:\.\s*retrohandler|\[\s*['"]retrohandler['"]\s*\])/.test(readFileSync(file, 'utf8'))
    ) {
      violations.push(referenceName(file, 'direct preload access'));
    }
    for (const reference of imports(file)) {
      if (/^(?:electron|better-sqlite3|sqlite3|node:|fs(?:\/|$))/.test(reference)) {
        violations.push(referenceName(file, reference));
      }
      if (reference.startsWith('.')) {
        const target = path.resolve(path.dirname(file), reference);
        if (!inside(root, target) && target !== path.resolve(root, '../shared')) {
          violations.push(referenceName(file, reference));
        }
      }
    }
  }
  assert.deepEqual(violations, []);
});

test('JSX contains presentation and named action bindings, not state, effects or async workflows', () => {
  const forbiddenHooks = new Set([
    'useState',
    'useEffect',
    'useLayoutEffect',
    'useReducer',
    'useRef',
    'useMemo',
    'useCallback',
    'useSyncExternalStore'
  ]);
  const violations: string[] = [];
  for (const file of sourceFiles(root).filter((file) => file.endsWith('.tsx'))) {
    const tree = source(file);
    for (const reference of imports(file)) {
      if (reference.startsWith('.') && path.resolve(path.dirname(file), reference) === api.slice(0, -3)) {
        violations.push(referenceName(file, 'API import in a view'));
      }
    }
    visit(tree, (node) => {
      if (ts.isCallExpression(node)) {
        const name = ts.isIdentifier(node.expression)
          ? node.expression.text
          : ts.isPropertyAccessExpression(node.expression)
            ? node.expression.name.text
            : '';
        if (forbiddenHooks.has(name)) violations.push(referenceName(file, name));
      }
      if (ts.isAwaitExpression(node) || ts.isTryStatement(node) || node.kind === ts.SyntaxKind.AsyncKeyword) {
        violations.push(referenceName(file, 'asynchronous workflow in JSX'));
      }
      if (
        ts.isJsxAttribute(node) &&
        /^on[A-Z]/.test(node.name.getText(tree)) &&
        node.initializer &&
        ts.isJsxExpression(node.initializer)
      ) {
        const expression = node.initializer.expression;
        if (
          expression &&
          (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) &&
          ts.isBlock(expression.body)
        ) {
          violations.push(referenceName(file, `block event handler ${node.name.getText(tree)}`));
        }
      }
    });
  }
  assert.deepEqual(violations, []);
});

test('controllers and models do not import view components or CSS', () => {
  const violations = sourceFiles(root)
    .filter((file) => !file.endsWith('.tsx'))
    .flatMap((file) =>
      imports(file)
        .filter((reference) => {
          if (reference.endsWith('.css') || reference.endsWith('.tsx')) return true;
          if (!reference.startsWith('.')) return false;
          const target = path.resolve(path.dirname(file), reference);
          return existsSync(`${target}.tsx`) || existsSync(path.join(target, 'index.tsx'));
        })
        .map((reference) => referenceName(file, reference))
    );
  assert.deepEqual(violations, []);
});

test('all renderer modules parse and their relative imports resolve after moving features', () => {
  const violations: string[] = [];
  for (const file of sourceFiles(root)) {
    for (const reference of imports(file)) {
      if (!reference.startsWith('.')) continue;
      const target = path.resolve(path.dirname(file), reference);
      if (
        ![
          target,
          `${target}.ts`,
          `${target}.tsx`,
          path.join(target, 'index.ts'),
          path.join(target, 'index.tsx')
        ].some((candidate) => existsSync(candidate))
      ) {
        violations.push(referenceName(file, `missing ${reference}`));
      }
    }
    if (file.endsWith('.d.ts')) continue;
    const { diagnostics } = ts.transpileModule(readFileSync(file, 'utf8'), {
      fileName: file,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
        isolatedModules: true
      },
      reportDiagnostics: true
    });
    for (const diagnostic of diagnostics ?? []) {
      if (diagnostic.category === ts.DiagnosticCategory.Error) {
        violations.push(referenceName(file, ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')));
      }
    }
  }
  assert.deepEqual(violations, []);
});

test('framework-independent controllers cannot reach React, Electron, DOM globals or the preload adapter', () => {
  const files = sourceFiles(root);
  const controllers = files.filter((file) => /(?:[A-Z][A-Za-z]*Controller|controller-state)\.ts$/.test(file));
  assert.ok(controllers.length >= 9, 'feature controllers must be independently testable');
  const violations: string[] = [];
  const visited = new Set<string>();
  function inspect(file: string): void {
    if (visited.has(file)) return;
    visited.add(file);
    if (/\b(?:window|document)\s*\./.test(readFileSync(file, 'utf8')))
      violations.push(referenceName(file, 'DOM access'));
    for (const reference of imports(file)) {
      if (!reference.startsWith('.')) {
        violations.push(referenceName(file, `external dependency ${reference}`));
        continue;
      }
      const target = path.resolve(path.dirname(file), reference);
      if (target === path.resolve(root, '../shared')) continue;
      if (
        !inside(root, target) ||
        target === api.slice(0, -3) ||
        /(?:^|[/\\])use[A-Z]/.test(target) ||
        !existsSync(`${target}.ts`)
      ) {
        violations.push(referenceName(file, `integration dependency ${reference}`));
      } else {
        inspect(`${target}.ts`);
      }
    }
  }
  controllers.forEach(inspect);
  assert.deepEqual(violations, []);
});
