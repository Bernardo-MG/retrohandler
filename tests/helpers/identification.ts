import { SevenZipArchiveReader, type ArchiveReader } from '../../src/main/components/archives';
import { FingerprintReader } from '../../src/main/components/hashing/fingerprint-reader';
import type { IdentificationRepository } from '../../src/main/contracts/persistence';
import { IdentificationService } from '../../src/main/identification';
import { DatReader } from '../../src/main/identification/dat/dat-reader';
import {
  ArchivedRomFingerprint,
  DirectRomFingerprint,
  RomFingerprintReader
} from '../../src/main/identification/rom/rom-fingerprint-reader';

export function identificationService(
  repository: IdentificationRepository,
  archive: ArchiveReader = new SevenZipArchiveReader()
): IdentificationService {
  const reader = new FingerprintReader();
  const fingerprints = new RomFingerprintReader([
    new DirectRomFingerprint(repository, reader),
    new ArchivedRomFingerprint(archive, reader)
  ]);
  return new IdentificationService(repository, fingerprints, new DatReader());
}
