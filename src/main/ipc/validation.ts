import path from 'node:path';

export function isText(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length <= limit;
}

export function isJobId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
}

export function isCollectionPath(value: unknown): value is string {
  return isText(value, 4096) && path.isAbsolute(value) && !value.includes('\0');
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && allowed.some((item) => item === value);
}
