const assert = require('node:assert/strict');
const path = require('node:path');

async function bundlePreload() {
  const { build } = await import('vite');
  const root = path.resolve(__dirname, '../..');
  const result = await build({
    configFile: false,
    root,
    publicDir: false,
    build: {
      target: 'node22',
      outDir: path.join(root, 'dist-electron', 'preload'),
      emptyOutDir: true,
      minify: false,
      reportCompressedSize: false,
      lib: {
        entry: path.join(root, 'src', 'preload', 'preload.ts'),
        formats: ['cjs'],
        fileName: () => 'preload.js'
      },
      rollupOptions: {
        external: ['electron'],
        output: { inlineDynamicImports: true }
      }
    }
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((item) => item.output);
  const chunks = outputs.filter((item) => item.type === 'chunk');
  assert.equal(chunks.length, 1, 'Sandboxed preload must be a single bundled JavaScript file.');
  assert.equal(chunks[0].fileName, 'preload.js');
  assert.deepEqual(chunks[0].imports, ['electron']);
  assert.deepEqual(chunks[0].dynamicImports, []);
}

bundlePreload().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
