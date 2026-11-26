import type { IdentificationResult } from '../../shared';

export type FingerprintMatch = Pick<IdentificationResult, 'status' | 'title' | 'datName'>;

export interface FingerprintMatchCandidate {
  game: string;
  datName: string;
  evidence: string;
}

/** SHA-1 and MD5 outrank CRC32. Different titles at the strongest level are ambiguous. */
export function matchFingerprintCandidates(candidates: readonly FingerprintMatchCandidate[]): FingerprintMatch {
  if (!candidates.length) {
    return { status: 'unknown', title: null, datName: null };
  }
  const strongest = selectStrongest(candidates);
  const first = strongest[0];
  if (strongest.some(candidate => candidate.game !== first.game)) {
    return { status: 'ambiguous', title: null, datName: null };
  }
  return {
    status: first.evidence === 'crc' ? 'probable' : 'verified',
    title: first.game,
    datName: first.datName
  };
}

function selectStrongest(candidates: readonly FingerprintMatchCandidate[]): readonly FingerprintMatchCandidate[] {
  const sha1 = candidates.filter(hasSha1);
  if (sha1.length) {
    return sha1;
  }
  const md5 = candidates.filter(hasMd5);
  return md5.length ? md5 : candidates;
}

function hasSha1(candidate: FingerprintMatchCandidate): boolean {
  return candidate.evidence === 'sha1';
}

function hasMd5(candidate: FingerprintMatchCandidate): boolean {
  return candidate.evidence === 'md5';
}
