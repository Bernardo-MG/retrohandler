import { sha256 } from '../../utils/hashing';

export const sha256OrNull = (bytes: Buffer | null) => (bytes === null ? null : sha256(bytes));
