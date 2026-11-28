import type { SystemCatalogueDefinition, SystemDefinition, SystemPluginSettings } from './system-definition';

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const EXTENSION = /^\.[a-z0-9]{1,16}$/;
const FORBIDDEN_KEYS = new Set(['constructor', 'prototype', '__proto__']);

function invalid(field: string): never {
  throw new Error(`Invalid system catalogue: ${field}.`);
}

function record(value: unknown, field: string, keys?: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalid(field);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return invalid(field);
  }
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some((key) => FORBIDDEN_KEYS.has(key) || (keys && !keys.includes(key)))) {
    return invalid(field);
  }
  return result;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 256 || /[\x00-\x1f\x7f]/.test(value)) {
    return invalid(field);
  }
  return value.trim();
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || !ID.test(value) || FORBIDDEN_KEYS.has(value)) {
    return invalid(field);
  }
  return value;
}

function strings(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value)) {
    return invalid(field);
  }
  return Object.freeze(Array.from(value, (item) => text(item, field)));
}

function extensions(value: unknown, field: string): readonly string[] {
  const entries = strings(value, field).map((entry) => entry.toLowerCase());
  if (entries.some((entry) => !EXTENSION.test(entry)) || new Set(entries).size !== entries.length) {
    return invalid(field);
  }
  return Object.freeze(entries);
}

function directories(value: unknown): readonly string[] {
  const entries = strings(value, 'scanning.directories');
  if (entries.some((entry) => /[<>:"/\\|?*]/.test(entry) || entry === '.' || entry === '..')) {
    return invalid('scanning.directories');
  }
  return entries;
}

function dictionary<T>(entries: readonly (readonly [string, T])[]): Readonly<Partial<Record<string, T>>> {
  const result: Record<string, T> = Object.create(null);
  for (const [key, value] of entries) {
    result[key] = value;
  }
  return Object.freeze(result);
}

function plugins(value: unknown): SystemDefinition['plugins'] {
  const settings = record(value, 'plugins');
  return dictionary(
    Object.entries(settings).map(([id, raw]) => {
      identifier(id, 'plugin ID');
      const values = record(raw, `plugins.${id}`);
      const result: SystemPluginSettings = dictionary(
        Object.entries(values).map(([key, setting]) => {
          const field = `plugins.${id}.${key}`;
          return [key, Array.isArray(setting) ? strings(setting, field) : text(setting, field)];
        })
      );
      return [id, result];
    })
  );
}

function system(value: unknown): SystemDefinition {
  const raw = record(value, 'system', [
    'id',
    'name',
    'manufacturer',
    'enabled',
    'aliases',
    'scanning',
    'identification',
    'plugins'
  ]);
  const scanning = record(raw.scanning, 'scanning', ['directories', 'extensions']);
  const identification = record(raw.identification, 'identification', ['extensions']);
  if (typeof raw.enabled !== 'boolean') {
    return invalid('enabled');
  }
  const scanExtensions = extensions(scanning.extensions, 'scanning.extensions');
  const identifyExtensions = extensions(identification.extensions, 'identification.extensions');
  if (identifyExtensions.some((extension) => !scanExtensions.includes(extension))) {
    return invalid('identification extensions must also be scannable');
  }
  return Object.freeze({
    id: identifier(raw.id, 'id'),
    name: text(raw.name, 'name'),
    manufacturer: raw.manufacturer === null ? null : text(raw.manufacturer, 'manufacturer'),
    enabled: raw.enabled,
    aliases: strings(raw.aliases, 'aliases'),
    scanning: Object.freeze({ directories: directories(scanning.directories), extensions: scanExtensions }),
    identification: Object.freeze({ extensions: identifyExtensions }),
    plugins: plugins(raw.plugins)
  });
}

/** Validate untrusted data and return an independent, immutable snapshot. */
export function validateSystemCatalogue(value: unknown): SystemCatalogueDefinition {
  const raw = record(value, 'root', ['systems', 'additionalFormats']);
  if (!Array.isArray(raw.systems)) {
    return invalid('systems');
  }
  const systems = Array.from(raw.systems, system);
  const ids = new Set<string>();
  for (const definition of systems) {
    if (ids.has(definition.id)) {
      return invalid(`duplicate ID ${definition.id}`);
    }
    ids.add(definition.id);
  }
  const formats = record(raw.additionalFormats, 'additionalFormats', ['scanning', 'identification']);
  const scanning = extensions(formats.scanning, 'additionalFormats.scanning');
  const identification = extensions(formats.identification, 'additionalFormats.identification');
  if (identification.some((extension) => !scanning.includes(extension))) {
    return invalid('additional identification extensions must also be scannable');
  }
  return Object.freeze({
    systems: Object.freeze(systems),
    additionalFormats: Object.freeze({ scanning, identification })
  });
}
