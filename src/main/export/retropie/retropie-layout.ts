import path from 'node:path';
import { RETROPIE_SYSTEM_MAP, type LibraryEntry } from '../../../shared';
import { hasInvalidXmlChars } from '../../components/xml/xml-text';

type RomDestination = {
  system: string;
  filename: string;
  relativeDestination: string;
};

/** Owns all RetroPie-specific directory and reference layout rules for one export. */
export class RetroPieLayout {
  constructor(private readonly overrides: Readonly<Record<string, string>>) { }

  /** Determine the RetroPie ROM reference, or explain why it cannot be exported. */
  resolveRomDestination(entry: Pick<LibraryEntry, 'system' | 'relativePath'>): RomDestination | { warning: string } {
    const system = this.mapPlatform(entry.system);
    if (!system) {
      return { warning: `Unmapped system: ${entry.system}` };
    }
    const filename = path.win32.basename(entry.relativePath.replace(/\//g, '\\'));
    if (!this.isSupportedFilename(filename)) {
      return { warning: `Unsupported filename: ${entry.relativePath}` };
    }
    if (['.rar', '.7z'].includes(path.extname(filename).toLowerCase())) {
      return { warning: `RetroPie emulator compatibility not established for ${entry.relativePath}; convert to a supported format first.` };
    }
    return { system, filename, relativeDestination: `${this.systemDirectory(system)}/${filename}` };
  }

  artworkDestination(system: string, id: string): string {
    return `${this.systemDirectory(system)}/${this.artworkRelativePath(id)}`;
  }

  gameListDestination(system: string): string {
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
  normalizeGameReference(value: string, system: string): string | null {
    let reference = value.trim();
    const absolute = /^(?:~|\/home\/[^/]+)\/RetroPie\/roms\/([^/]+)\/(.*)$/.exec(reference);
    if (absolute) {
      if (absolute[1] !== system) {
        return null;
      }
      reference = absolute[2];
    }
    if (reference.startsWith('/') || reference.startsWith('~') || reference.includes('\\') || /^[A-Za-z]:/.test(reference)) {
      return null;
    }
    const normalizedPath = path.posix.normalize(reference);
    return normalizedPath === '..' || normalizedPath.startsWith('../') ? null : normalizedPath;
  }

  private isSupportedFilename(filename: string): boolean {
    const reservedName = !filename || filename === '.' || filename === '..';
    const invalidCharacters = /[<>:"/\\|?*\x00-\x1f]/.test(filename) || hasInvalidXmlChars(filename);
    return !reservedName && !invalidCharacters && !/[. ]$/.test(filename);
  }

  private systemDirectory(system: string): string {
    return `roms/${system}`;
  }

  private artworkRelativePath(id: string): string {
    return `images/${id}`;
  }

  /** Unknown platforms require an explicit override. */
  private mapPlatform(system: string): string | null {
    const mappedSystem = this.lookupPlatform(system);
    if (!mappedSystem || !/^[a-z0-9][a-z0-9_-]{0,49}$/.test(mappedSystem) ||
      ['con', 'prn', 'nul', 'aux'].includes(mappedSystem)) {
      return null;
    }
    return mappedSystem;
  }

  private lookupPlatform(system: string): string | undefined {
    if (Object.hasOwn(this.overrides, system)) {
      return this.overrides[system];
    }
    if (Object.hasOwn(RETROPIE_SYSTEM_MAP, system)) {
      return RETROPIE_SYSTEM_MAP[system];
    }
    return undefined;
  }
}
