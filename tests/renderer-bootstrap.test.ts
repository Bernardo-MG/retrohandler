import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultSettings, type SettingsSnapshot } from '../src/shared';
import { initializeApplication } from '../src/renderer/app/bootstrap';
import { watchTheme } from '../src/renderer/app/theme';
import { desktopApi } from '../src/renderer/api/desktop-api';

async function withDesktop(
  getSettings: () => Promise<SettingsSnapshot>,
  dark: boolean,
  run: (environment: { dataset: Record<string, string>; changeTheme(dark: boolean): void; listenerCount(): number }) => Promise<void>
): Promise<void> {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const dataset: Record<string, string> = {};
  const listeners = new Set<() => void>();
  const media = {
    matches: dark,
    addEventListener(_type: string, listener: () => void) { listeners.add(listener); },
    removeEventListener(_type: string, listener: () => void) { listeners.delete(listener); }
  };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { retrohandler: { getSettings }, matchMedia: () => media }
  });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: { dataset } } });
  try {
    await run({
      dataset,
      changeTheme(value) {
        media.matches = value;
        for (const listener of listeners) listener();
      },
      listenerCount: () => listeners.size
    });
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  }
}

test('application bootstrap hydrates settings through the desktop bridge before applying theme', async () => {
  const initial: SettingsSnapshot = { settings: defaultSettings(), warning: 'Saved warning' };
  initial.settings.appearance.theme = 'system';
  initial.settings.library.search = 'saved search';
  await withDesktop(async () => initial, false, async environment => {
    assert.equal(await desktopApi().getSettings(), initial);
    assert.equal(await initializeApplication(), initial);
    assert.equal(environment.dataset.theme, 'light');
  });
});

test('failed settings hydration preserves the default-settings fallback and error notice', async () => {
  await withDesktop(async () => { throw new Error('Settings unavailable'); }, false, async environment => {
    const result = await initializeApplication();
    assert.deepEqual(result.settings, defaultSettings());
    assert.match(result.warning ?? '', /Could not load application preferences:.*Settings unavailable/);
    assert.equal(environment.dataset.theme, 'dark');
  });
});

test('theme changes follow the system only when requested and remove their listener on cleanup', async () => {
  await withDesktop(async () => ({ settings: defaultSettings(), warning: null }), false, async environment => {
    const stop = watchTheme('system');
    assert.equal(environment.dataset.theme, 'light');
    assert.equal(environment.listenerCount(), 1);
    environment.changeTheme(true);
    assert.equal(environment.dataset.theme, 'dark');
    stop();
    assert.equal(environment.listenerCount(), 0);
    environment.changeTheme(false);
    assert.equal(environment.dataset.theme, 'dark');
    const stopLight = watchTheme('light');
    environment.changeTheme(true);
    assert.equal(environment.dataset.theme, 'light');
    stopLight();
    assert.equal(environment.listenerCount(), 0);
  });
});
