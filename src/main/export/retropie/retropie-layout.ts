import path from 'node:path';
import { RETROPIE_SYSTEM_MAP, type LibraryEntry } from '../../../shared';
import { hasInvalidXmlChars } from '../../components/xml/xml-text';

/** Owns all RetroPie-specific directory and reference layout rules for one export. */
export class RetroPieLayout {
  constructor(private readonly overrides: Readonly<Record<string, string>>) {}

  /** Determine the RetroPie ROM reference, or explain why it cannot be exported. */
  resolveRom(entry: Pick<LibraryEntry, 'system' | 'relativePath'>): { system: string; filename: string; relativeDestination: string } | { warning: string } {
    const system = this.mapSystem(entry.system);
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
    return { system, filename, relativeDestination: `${this.systemDirectory(system)}/${filename}` };
  }

  artworkPath(system: string, id: string): string {
    return `${this.systemDirectory(system)}/${this.artworkRelativePath(id)}`;
  }

  gamelistPath(system: string): string {
    return `${this.systemDirectory(system)}/gamelist.xml`;
  }

  romReference(filename: string): string {
    return `./${filename}`;
  }

  artworkReference(id: string): string {
    return `./${this.artworkRelativePath(id)}`;
  }

  // Match local system-relative paths and standard RetroPie home-directory paths.
  // Do not infer that a game in a different subdirectory is the same ROM.
  resolveGamePath(value: string, system: string): string | null {
    let p = value.trim();
    const absolute = /^(?:~|\/home\/[^/]+)\/RetroPie\/roms\/([^/]+)\/(.*)$/.exec(p);
    if (absolute) {
      if (absolute[1] !== system) {
        return null;
      }
      p = absolute[2];
    }
    if (p.startsWith('/') || p.startsWith('~') || p.includes('\\') || /^[A-Za-z]:/.test(p)) {
      return null;
    }
    const key = path.posix.normalize(p);
    return key === '..' || key.startsWith('../') ? null : key;
  }

  private systemDirectory(system: string): string {
    return `roms/${system}`;
  }

  private artworkRelativePath(id: string): string {
    return `images/${id}`;
  }

  /** Unknown platforms require an explicit override. */
  private mapSystem(system: string): string | null {
    const mapped = Object.prototype.hasOwnProperty.call(this.overrides, system)
      ? this.overrides[system]
      : Object.prototype.hasOwnProperty.call(RETROPIE_SYSTEM_MAP, system) ? RETROPIE_SYSTEM_MAP[system] : undefined;
    return mapped && /^[a-z0-9][a-z0-9_-]{0,49}$/.test(mapped) && !['con', 'prn', 'nul', 'aux'].includes(mapped)
      ? mapped
      : null;
  }
}
