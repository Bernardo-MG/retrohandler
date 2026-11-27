import { createHash } from 'node:crypto';

export const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export const sha256OrNull = (bytes: Buffer | null) => (bytes === null ? null : sha256(bytes));
