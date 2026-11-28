import { RETROPIE_SYSTEM_MAP, type ExportPlan, type ExportPreferences } from '../../../shared';

export function normalizedOverrides(overrides: ExportPreferences['overrides']): Record<string, string> {
  return Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== ''));
}

/** Do not persist incomplete mapping edits. The backend still validates every export. */
export function validPreferences(preferences: ExportPreferences): ExportPreferences | null {
  const overrides = normalizedOverrides(preferences.overrides);
  if (
    Object.entries(overrides).some(
      ([key, value]) =>
        !key.trim() ||
        key.length > 256 ||
        ['__proto__', 'constructor', 'prototype'].includes(key) ||
        !/^[a-z0-9][a-z0-9_-]{0,49}$/.test(value) ||
        ['con', 'prn', 'aux', 'nul'].includes(value)
    )
  ) {
    return null;
  }
  return { ...preferences, overrides };
}

export function mappingRows(systems: string[], overrides: ExportPreferences['overrides']) {
  return systems.map((system) => ({
    system,
    folder:
      (Object.hasOwn(overrides, system) ? overrides[system] : undefined) ??
      (Object.hasOwn(RETROPIE_SYSTEM_MAP, system) ? RETROPIE_SYSTEM_MAP[system] : '')
  }));
}

export function summarizePlan(plan: ExportPlan) {
  const references = plan.files.filter((file) => file.kind === 'rom').length;
  const created = plan.files.filter((file) => file.action === 'create');
  const updated = plan.files.filter((file) => file.action === 'update');
  const reused = plan.files.filter((file) => file.action === 'reuse').length;
  const writtenFiles = plan.files.filter((file) => file.action === 'create' || file.action === 'update');
  const bytesToWrite = writtenFiles.reduce((sum, file) => sum + file.size, 0);
  return {
    references,
    created: created.length,
    updated: updated.length,
    reused,
    writtenFiles,
    mibToWrite: (bytesToWrite / (1024 * 1024)).toFixed(2),
    canGenerate: references > 0 && plan.conflicts.length === 0
  };
}
