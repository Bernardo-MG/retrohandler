import path from 'node:path';
import type { LibraryEntry } from '../../../shared';
import { hasInvalidXmlChars } from '../../components/xml/xml-text';
import { mapSystem } from './system-mapping';

/** Determine the RetroPie ROM reference, or explain why it cannot be exported. */
export function resolveRomLayout(entry: Pick<LibraryEntry, 'system' | 'relativePath'>, overrides: Readonly<Record<string, string>>):
  { system: string; filename: string; relativeDestination: string } | { warning: string } {
  const system = mapSystem(entry.system, overrides);
  if (!system) {
    return { warning: `Unmapped system: ${entry.system}` };
  }
  const filename = path.win32.basename(entry.relativePath.replace(/\//g, '\\'));
  if (!filename || filename === '.' || filename === '..' || /[<>:"/\\|?*\x00-\x1f]/.test(filename) || /[. ]$/.test(filename) || hasInvalidXmlChars(filename)) {
    return { warning: `Unsupported filename: ${entry.relativePath}` };
  }
  if (['.rar', '.7z'].includes(path.extname(filename).toLowerCase())) {
    return { warning: `RetroPie emulator compatibility not established for ${entry.relativePath}; convert to a supported format first.` };
  }
  return { system, filename, relativeDestination: `roms/${system}/${filename}` };
}
