import path from 'node:path';
import { MAX_ARCHIVE_MEMBERS, type ArchiveMember } from '../../components/archives/archive-reader';

// A compressed container or disc image is not the underlying ROM.
const ARCHIVES = new Set(['.zip', '.rar', '.7z']);
const DIRECT_ROMS = new Set([
  '.nes', '.fds', '.sfc', '.smc', '.gb', '.gbc', '.gba', '.n64', '.z64', '.v64', '.nds',
  '.md', '.gen', '.smd', '.sms', '.gg', '.a26', '.a78', '.pce', '.ngp', '.ngc', '.ws', '.wsc', '.rom'
]);
const MAX_ROM_BYTES = 1024 * 1024 * 1024;

export function isRomArchive(extension: string): boolean {
  return ARCHIVES.has(extension.toLowerCase());
}

export function isDirectRom(extension: string): boolean {
  return DIRECT_ROMS.has(extension.toLowerCase());
}

/** A single library row must not be identified as one ROM if it contains several. */
export function selectRomMember(members: readonly ArchiveMember[]): ArchiveMember | null {
  if (members.length > MAX_ARCHIVE_MEMBERS) {
    throw new Error('Too many archive entries.');
  }
  const candidates = members.filter(isRomMember);
  if (candidates.length !== 1) {
    return null;
  }
  const member = candidates[0];
  if (!Number.isSafeInteger(member.size) || member.size < 0 || member.size > MAX_ROM_BYTES) {
    throw new Error('ROM member exceeds size limit.');
  }
  return member;
}

function isRomMember(member: ArchiveMember): boolean {
  return !member.directory && isDirectRom(path.extname(member.name));
}
