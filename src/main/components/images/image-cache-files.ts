import { randomUUID } from 'node:crypto';

const TEMPORARY_NAME = /^\.download-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export function temporaryImageName(): string {
  return `.download-${randomUUID()}`;
}

export function isTemporaryImageName(name: string): boolean {
  return TEMPORARY_NAME.test(name);
}
