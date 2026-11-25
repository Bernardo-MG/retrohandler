const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { cleanRelease, assertX64Pe, verifyPackage } = require('../scripts/package-windows.cjs');
const pkg = require('../package.json');
function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retrohandler-packaging-'));
  try { fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
function put(file, bytes) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); }
function pe(machine = 0x8664) { const b = Buffer.alloc(128); b.write('MZ'); b.writeUInt32LE(64,60); b.writeUInt32LE(0x4550,64); b.writeUInt16LE(machine,68); return b; }
test('installer keeps identity and user data, supports per-user installation', () => {
  assert.equal(pkg.build.appId, 'com.retrohandler.desktop');
  assert.equal(pkg.build.productName, 'RetroHandler');
  assert.equal(pkg.build.nsis.perMachine, false);
  assert.equal(pkg.build.nsis.deleteAppDataOnUninstall, false);
  assert.equal(pkg.build.nsis.oneClick, false);
  assert.equal(pkg.build.nsis.allowToChangeInstallationDirectory, true);
  assert.deepEqual(pkg.build.win.target, [{target:'nsis',arch:['x64']}]);
  assert.equal(pkg.build.npmRebuild, true);
  assert.ok(pkg.build.asarUnpack.some(x => x.includes('better-sqlite3')));
});
test('clean removes build outputs but preserves data and sources', () => fixture(dir => {
  for (const name of ['dist','dist-electron','dist-tests','release','src','artwork']) put(path.join(dir,name,'file'),'data');
  for (const name of ['settings.json','library.sqlite']) put(path.join(dir,name),'data');
  cleanRelease(dir);
  for (const name of ['dist','dist-electron','dist-tests','release']) assert.equal(fs.existsSync(path.join(dir,name)),false);
  for (const name of ['src','artwork','settings.json','library.sqlite']) assert.equal(fs.existsSync(path.join(dir,name)),true);
}));
test('PE verification rejects wrong architecture and truncated files', () => fixture(dir => {
  const file = path.join(dir,'file'); put(file,pe()); assert.doesNotThrow(() => assertX64Pe(file));
  put(file,pe(0x14c)); assert.throws(() => assertX64Pe(file),/x64/);
  put(file,'MZ'); assert.throws(() => assertX64Pe(file),/PE/);
}));
test('package verification requires installer, archive and native binary', () => fixture(dir => {
  const release = path.join(dir,'release'); const app = path.join(release,'win-unpacked');
  put(path.join(app,'RetroHandler.exe'),pe()); put(path.join(app,'resources','app.asar'),'archive');
  const native = path.join(app,'resources','app.asar.unpacked','node_modules','better-sqlite3','build','Release','better_sqlite3.node');
  assert.throws(() => verifyPackage(dir,true,false)); put(native,pe());
  assert.doesNotThrow(() => verifyPackage(dir,true,false)); assert.throws(() => verifyPackage(dir,false,false));
  put(path.join(release,`RetroHandler-Setup-${pkg.version}-x64.exe`),pe(0x14c));
  assert.doesNotThrow(() => verifyPackage(dir,false,false));
  put(native,pe(0x14c)); assert.throws(() => verifyPackage(dir,false,false),/x64/);
}));
