import path from 'node:path';
import { assertSafeDirectory } from '../components/filesystem/paths';
import { readRegular } from '../components/filesystem/file-reader';
import { hash, hashOrNull, targetPath, type FileOperation } from './export-plan';

/** Inspect a source file without retaining its bytes in the prepared export. */
export async function planCopy(
  destination: string,
  relative: string,
  file: string,
  expectedSize: number,
  maxBytes: number,
  label: string
): Promise<FileOperation> {
  const target = targetPath(destination, relative);
  await assertSafeDirectory(path.dirname(target));
  const source = await readRegular(file, maxBytes);
  if (!source || source.length !== expectedSize) {
    throw new Error(`Cached ${label} changed; preview again.`);
  }
  const prior = await readRegular(target, maxBytes);
  const output = hash(source);
  const previous = hashOrNull(prior);
  if (previous !== null && previous !== output) {
    throw new Error(`Existing ${label} differs from cached ${label}.`);
  }
  return {
    relativeDestination: relative,
    content: { file },
    maxBytes,
    size: source.length,
    action: prior === null ? 'create' : 'reuse',
    previous,
    output
  };
}

/** The consumer supplies the format-specific generation or merge policy. */
export async function planGenerated(
  destination: string,
  relative: string,
  maxBytes: number,
  generate: (previous: Buffer | null) => Buffer
): Promise<FileOperation> {
  const target = targetPath(destination, relative);
  await assertSafeDirectory(path.dirname(target));
  const prior = await readRegular(target, maxBytes);
  const bytes = generate(prior);
  if (bytes.length > maxBytes) {
    throw new Error('Generated file exceeds size limit.');
  }
  const previous = hashOrNull(prior);
  const output = hash(bytes);
  return {
    relativeDestination: relative,
    content: { bytes },
    maxBytes,
    size: bytes.length,
    action: prior === null ? 'create' : previous === output ? 'reuse' : 'update',
    previous,
    output
  };
}
