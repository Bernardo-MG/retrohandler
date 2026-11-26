import path from 'node:path';
import { MAX_ARCHIVE_MEMBERS, type ArchiveMember } from '../../components/archives/archive-reader';

import { isDirectRom } from '../../rom/rom-formats';

const MAX_ROM_BYTES = 1024 * 1024 * 1024;

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
