import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDefaultSystemCatalogue, SystemCatalogue } from '../../src/main/systems';

function customSystem(id = 'custom') {
  return {
    id,
    name: 'Custom system',
    manufacturer: null,
    enabled: true,
    aliases: ['Example'],
    scanning: { directories: ['example'], extensions: ['.TEST'] },
    identification: { extensions: ['.test'] },
    plugins: { example: { platform: 'Example catalogue', aliases: ['Example One'] } }
  };
}

function configuration(systems = [customSystem()]) {
  return { systems, additionalFormats: { scanning: ['.bin'], identification: [] } };
}

test('bundled systems retain the existing mappings and distinguish scan hints from direct ROMs', () => {
  const catalogue = createDefaultSystemCatalogue();
  const snes = catalogue.get('snes');
  assert.equal(snes?.name, 'Super Nintendo');
  assert.ok(snes?.aliases.includes('Super Famicom'));
  assert.deepEqual(snes?.scanning.directories, ['snes', 'sfc']);
  assert.deepEqual(snes?.identification.extensions, ['.sfc', '.smc']);
  assert.equal(snes?.plugins.retropie?.folder, 'snes');
  assert.equal(snes?.plugins.libretro?.platform, 'Nintendo - Super Nintendo Entertainment System');
  assert.deepEqual(snes?.plugins.launchbox?.platforms, ['Super Nintendo Entertainment System']);
  assert.equal(catalogue.get('dos')?.plugins.retropie?.folder, 'pc');
  assert.equal(catalogue.get('arcade')?.plugins.libretro, undefined);
  assert.deepEqual(catalogue.get('psx')?.scanning.extensions, ['.pbp']);
  assert.deepEqual(catalogue.get('psx')?.identification.extensions, []);
  assert.deepEqual(catalogue.get('psp')?.scanning.extensions, ['.cso']);
  assert.deepEqual(catalogue.get('psp')?.identification.extensions, []);
  assert.equal(catalogue.get('Needs identification'), undefined);
});

test('bundled formats preserve inventory and fingerprint eligibility without inferring generic formats', () => {
  const { systems, additionalFormats } = createDefaultSystemCatalogue().snapshot();
  const direct = new Set([
    ...systems.flatMap((system) => system.identification.extensions),
    ...additionalFormats.identification
  ]);
  const inventory = new Set([
    ...systems.flatMap((system) => system.scanning.extensions),
    ...additionalFormats.scanning
  ]);
  assert.deepEqual(
    [...direct].sort(),
    [
      '.nes',
      '.fds',
      '.sfc',
      '.smc',
      '.gb',
      '.gbc',
      '.gba',
      '.n64',
      '.z64',
      '.v64',
      '.nds',
      '.md',
      '.gen',
      '.smd',
      '.sms',
      '.gg',
      '.a26',
      '.a78',
      '.pce',
      '.ngp',
      '.ngc',
      '.ws',
      '.wsc',
      '.rom'
    ].sort()
  );
  assert.deepEqual(
    [...inventory].sort(),
    [...direct, '.cue', '.gdi', '.chd', '.iso', '.cso', '.pbp', '.cdi', '.bin', '.wad'].sort()
  );
  assert.ok(additionalFormats.scanning.includes('.bin'));
  assert.ok(additionalFormats.scanning.includes('.iso'));
  assert.ok(!systems.some((system) => system.scanning.extensions.includes('.bin')));
});

test('custom and disabled systems retain stable identities and can share extensions', () => {
  const first = customSystem();
  const second = { ...customSystem('other'), name: 'Another system', enabled: false };
  const catalogue = new SystemCatalogue(configuration([first, second]));
  assert.equal(catalogue.get('custom')?.name, 'Custom system');
  assert.deepEqual(catalogue.get('custom')?.scanning.extensions, ['.test']);
  assert.equal(catalogue.get('other')?.enabled, false);
  assert.deepEqual(catalogue.list().map((system) => system.id), ['custom', 'other']);
  assert.equal(catalogue.get('missing'), undefined);
  assert.equal(catalogue.get('constructor'), undefined);
  assert.equal(catalogue.get('custom')?.plugins.toString, undefined);
});

test('catalogue snapshots cannot be changed through the original input or returned configuration', () => {
  const input = configuration();
  const catalogue = new SystemCatalogue(input);
  input.systems[0].name = 'Renamed';
  input.systems[0].aliases.push('New alias');
  input.systems[0].plugins.example.aliases.push('New platform');
  input.additionalFormats.scanning.push('.iso');
  const snapshot = catalogue.snapshot();
  assert.equal(catalogue.get('custom')?.name, 'Custom system');
  assert.deepEqual(catalogue.get('custom')?.aliases, ['Example']);
  assert.deepEqual(catalogue.get('custom')?.plugins.example?.aliases, ['Example One']);
  assert.deepEqual(snapshot.additionalFormats.scanning, ['.bin']);
  assert.throws(() => Object.assign(catalogue.get('custom')!, { name: 'Changed' }), TypeError);
  assert.throws(() => Object.assign(snapshot.additionalFormats.scanning, { 0: '.iso' }), TypeError);
  assert.throws(
    () => Object.assign(snapshot.systems[0].plugins.example!, { platform: 'Changed' }),
    TypeError
  );
});

test('invalid identities, flags and malformed catalogue structures are rejected', () => {
  for (const id of ['', 'Uppercase', '../escape', '__proto__', 'constructor', 'prototype']) {
    assert.throws(
      () => new SystemCatalogue(configuration([customSystem(id)])),
      /Invalid system catalogue: id/
    );
  }
  assert.throws(
    () => new SystemCatalogue(configuration([customSystem(), customSystem()])),
    /duplicate ID custom/
  );
  assert.throws(() => new SystemCatalogue(null), /Invalid system catalogue: root/);
  assert.throws(() => new SystemCatalogue({ ...configuration(), systems: {} }), /systems/);
  assert.throws(() => new SystemCatalogue({ ...configuration(), unknown: true }), /root/);
  assert.throws(() => new SystemCatalogue(configuration([{ ...customSystem(), name: ' ' }])), /name/);
  assert.throws(
    () => new SystemCatalogue({ ...configuration(), systems: [{ ...customSystem(), enabled: 'yes' }] }),
    /enabled/
  );
});

test('invalid extensions and unsafe directory hints are rejected', () => {
  for (const extension of ['nes', '../nes', '.n/es', '.']) {
    const system = customSystem();
    system.scanning.extensions = [extension];
    assert.throws(() => new SystemCatalogue(configuration([system])), /scanning.extensions/);
  }
  const duplicate = customSystem();
  duplicate.scanning.extensions.push('.test');
  assert.throws(() => new SystemCatalogue(configuration([duplicate])), /scanning.extensions/);
  const unsupported = customSystem();
  unsupported.identification.extensions = ['.other'];
  assert.throws(() => new SystemCatalogue(configuration([unsupported])), /must also be scannable/);
  for (const directory of ['..', '../example', 'nested/example', 'nested\\example']) {
    const system = customSystem();
    system.scanning.directories = [directory];
    assert.throws(() => new SystemCatalogue(configuration([system])), /scanning.directories/);
  }
  assert.throws(
    () =>
      new SystemCatalogue({ ...configuration(), additionalFormats: { scanning: [], identification: ['.rom'] } }),
    /additional identification extensions must also be scannable/
  );
});

test('integration configuration rejects unsafe keys and invalid data', () => {
  const system = customSystem();
  const input = (plugins: unknown) => ({ ...configuration(), systems: [{ ...system, plugins }] });
  assert.throws(() => new SystemCatalogue(input(JSON.parse('{"__proto__":{}}'))), /plugins/);
  assert.throws(() => new SystemCatalogue(input({ '../example': {} })), /plugin ID/);
  assert.throws(() => new SystemCatalogue(input({ example: JSON.parse('{"constructor":"x"}') })), /plugins/);
  assert.throws(
    () => new SystemCatalogue(input({ example: { platform: true } })),
    /plugins.example.platform/
  );
  assert.throws(
    () => new SystemCatalogue(input({ example: { aliases: ['valid', 123] } })),
    /plugins.example.aliases/
  );
});
