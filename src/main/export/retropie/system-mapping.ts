import { RETROPIE_SYSTEM_MAP } from '../../../shared';

/** Unknown platforms require an explicit override. */
export function mapSystem(system: string, overrides: Readonly<Record<string, string>>): string | null {
  const mapped = Object.prototype.hasOwnProperty.call(overrides, system)
    ? overrides[system]
    : Object.prototype.hasOwnProperty.call(RETROPIE_SYSTEM_MAP, system) ? RETROPIE_SYSTEM_MAP[system] : undefined;
  return mapped && /^[a-z0-9][a-z0-9_-]{0,49}$/.test(mapped) && !['con', 'prn', 'nul', 'aux'].includes(mapped)
    ? mapped
    : null;
}
