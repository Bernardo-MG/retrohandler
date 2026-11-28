import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  defaultSettings,
  type AppSettings,
  type AppearancePreferences,
  type ExportPreferences,
  type LibraryPreferences,
  type MetadataPreferences,
  type SettingsPatch,
  type SettingsSnapshot,
  type WindowBounds,
  type WindowPreferences
} from '../../shared';

const MAX_SETTINGS_BYTES = 1024 * 1024;
const SECTIONS = ['library', 'export', 'metadata', 'appearance'] as const;
const invalid = (): never => {
  throw new Error('Invalid application settings.');
};
const missing = (e: unknown) => (e as NodeJS.ErrnoException)?.code === 'ENOENT';

function record(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalid();
  }
  const obj = value as Record<string, unknown>;
  if (Object.getPrototypeOf(obj) !== Object.prototype && Object.getPrototypeOf(obj) !== null) {
    return invalid();
  }
  if (
    keys &&
    (Object.keys(obj).length !== keys.length ||
      keys.some((k) => !Object.prototype.hasOwnProperty.call(obj, k)))
  ) {
    return invalid();
  }
  return obj;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x1f]/.test(value)) {
    return invalid();
  }
  return value;
}
function bool(value: unknown): boolean {
  return typeof value === 'boolean' ? value : invalid();
}
function oneOf<const T extends string>(value: unknown, choices: readonly T[]): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) {
    return invalid();
  }
  return value as T;
}
function absolute(value: unknown, allowEmpty = false): string {
  const name = text(value, 4096);
  if (!(allowEmpty && !name) && !path.isAbsolute(name)) {
    return invalid();
  }
  return name;
}
function library(value: unknown): LibraryPreferences {
  const v = record(value, ['selected', 'search', 'system', 'sort', 'descending', 'identification', 'view']);
  return {
    selected: v.selected === null ? null : absolute(v.selected),
    search: text(v.search, 256),
    system: v.system === null ? null : text(v.system, 256),
    sort: oneOf(v.sort, ['name', 'system', 'bytes']),
    descending: bool(v.descending),
    identification:
      v.identification === null
        ? null
        : oneOf(v.identification, [
            'pending',
            'verified',
            'probable',
            'ambiguous',
            'unknown',
            'unsupported',
            'error'
          ]),
    view: oneOf(v.view, ['list', 'grid'])
  };
}
function exportPreferences(value: unknown): ExportPreferences {
  const v = record(value, ['destination', 'includeArtwork', 'overrides']);
  const raw = record(v.overrides);
  const overrides: Record<string, string> = {};
  if (Object.keys(raw).length > 1000) {
    return invalid();
  }
  for (const [key, val] of Object.entries(raw)) {
    if (
      !text(key, 256).trim() ||
      ['__proto__', 'prototype', 'constructor'].includes(key) ||
      typeof val !== 'string' ||
      !/^[a-z0-9][a-z0-9_-]{0,49}$/.test(val) ||
      ['con', 'prn', 'aux', 'nul'].includes(val)
    ) {
      return invalid();
    }
    overrides[key] = val;
  }
  return { destination: absolute(v.destination, true), includeArtwork: bool(v.includeArtwork), overrides };
}
function metadata(value: unknown): MetadataPreferences {
  const v = record(value, ['startWith', 'artwork']);
  return {
    startWith: oneOf(v.startWith, ['manual', 'launchbox']),
    artwork: oneOf(v.artwork, ['libretro', 'saved-only'])
  };
}
function appearance(value: unknown): AppearancePreferences {
  const v = record(value, ['theme']);
  return { theme: oneOf(v.theme, ['dark', 'light', 'system']) };
}
function integer(value: unknown, min: number, max: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
    ? value
    : invalid();
}
function windowPreferences(value: unknown): WindowPreferences {
  const v = record(value, ['bounds', 'maximized']);
  let bounds: WindowBounds | null = null;
  if (v.bounds !== null) {
    const b = record(v.bounds, ['x', 'y', 'width', 'height']);
    bounds = {
      x: integer(b.x, -100000, 100000),
      y: integer(b.y, -100000, 100000),
      width: integer(b.width, 1, 32768),
      height: integer(b.height, 1, 32768)
    };
  }
  return { bounds, maximized: bool(v.maximized) };
}
export function validateSettings(value: unknown): AppSettings {
  const v = record(value, ['version', ...SECTIONS, 'window']);
  if (v.version !== 1) {
    throw new Error('Unsupported application settings version.');
  }
  return {
    version: 1,
    library: library(v.library),
    export: exportPreferences(v.export),
    metadata: metadata(v.metadata),
    appearance: appearance(v.appearance),
    window: windowPreferences(v.window)
  };
}
export function validateSettingsPatch(value: unknown): SettingsPatch {
  const v = record(value);
  const keys = Object.keys(v);
  if (!keys.length || keys.some((k) => !SECTIONS.some((section) => section === k))) {
    return invalid();
  }
  const result: SettingsPatch = {};
  if ('library' in v) {
    result.library = library(v.library);
  }
  if ('export' in v) {
    result.export = exportPreferences(v.export);
  }
  if ('metadata' in v) {
    result.metadata = metadata(v.metadata);
  }
  if ('appearance' in v) {
    result.appearance = appearance(v.appearance);
  }
  return result;
}

/** The main process owns all settings writes. Synchronous, small transactions ensure
 * an export or window update cannot overwrite a concurrent library preference. */
export class SettingsStore {
  private current = defaultSettings();
  private warning: string | null = null;
  private writable = true;

  constructor(readonly filePath: string) {
    try {
      const stat = lstatSync(filePath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error('Settings path is not a regular file.');
      }
      const raw = stat.size > MAX_SETTINGS_BYTES ? null : readFileSync(filePath, 'utf8');
      try {
        if (raw === null) {
          throw new Error('Settings file is too large.');
        }
        const decoded: unknown = JSON.parse(raw);
        // An older application must not overwrite a newer settings schema.
        if (
          decoded &&
          typeof decoded === 'object' &&
          'version' in decoded &&
          typeof decoded.version === 'number' &&
          decoded.version > 1
        ) {
          this.writable = false;
          this.warning =
            'Settings were created by a newer RetroHandler version. Preferences are read-only in this version.';
          return;
        }
        this.current = validateSettings(decoded);
      } catch {
        const backup = `${filePath}.corrupt-${randomUUID()}.bak`;
        renameSync(filePath, backup);
        this.warning = `Invalid settings were backed up to ${backup}. Defaults have been restored.`;
      }
    } catch (error) {
      if (!missing(error)) {
        this.writable = false;
        this.warning = `Could not load settings; defaults are in use and settings writes are disabled: ${String(error)}`;
      }
    }
  }
  public snapshot(): SettingsSnapshot {
    return { settings: structuredClone(this.current), warning: this.warning };
  }
  public update(value: unknown): AppSettings {
    return this.commit({ ...this.current, ...validateSettingsPatch(value) });
  }
  public saveWindow(value: unknown): AppSettings {
    return this.commit({ ...this.current, window: windowPreferences(value) });
  }
  public reset(): AppSettings {
    return this.commit(defaultSettings(), true);
  }

  private commit(next: AppSettings, force = false): AppSettings {
    if (!this.writable) {
      throw new Error(this.warning ?? 'Settings are read-only.');
    }
    const data = JSON.stringify(next, null, 2) + '\n';
    if (Buffer.byteLength(data) > MAX_SETTINGS_BYTES) {
      throw new Error('Settings exceed the size limit.');
    }
    if (!force && JSON.stringify(next) === JSON.stringify(this.current)) {
      return structuredClone(this.current);
    }
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    // Refuse a redirected target, including a link created after startup.
    try {
      if (!lstatSync(this.filePath).isFile()) {
        throw new Error('Settings path is not a regular file.');
      }
    } catch (error) {
      if (!missing(error)) {
        throw error;
      }
    }
    const temp = `${this.filePath}.tmp-${randomUUID()}`;
    try {
      const fd = openSync(temp, 'wx', 0o600);
      try {
        writeFileSync(fd, data, 'utf8');
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(temp, this.filePath);
      this.current = next;
      this.warning = null;
      return structuredClone(this.current);
    } finally {
      rmSync(temp, { force: true });
    }
  }
}
