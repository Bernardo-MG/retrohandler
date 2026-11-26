import { createHash } from 'node:crypto';

export const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export const hashOrNull = (bytes: Buffer | null) => bytes === null ? null : hash(bytes);
