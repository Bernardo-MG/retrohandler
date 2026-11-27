import path from 'node:path';
import { registerLibraryIpc } from '../ipc/library-ipc';
import { registerIdentificationIpc } from '../ipc/identification-ipc';
import { IdentificationService } from '../identification';
import { DatReader } from '../identification/dat/dat-reader';
import {
  ArchivedRomFingerprint,
  DirectRomFingerprint,
  RomFingerprintReader
} from '../identification/rom/rom-fingerprint-reader';
import { createArchiveReader, createRestrictedArchiveReader } from '../components/archives';
import { MAX_ROM_BYTES } from '../identification/rom/archive-rom-selection';
import { FingerprintReader } from '../components/hashing/fingerprint-reader';
import type { IdentificationRepository } from '../contracts/persistence';
import { FileSystemLibraryService } from '../services/library';
import { registerImageProtocol, type ImageProtocolOptions } from './protocols/image-protocol';
import {
  openDatabase,
  createCollectionRepository,
  createRomRepository,
  createIdentificationRepository,
  createMetadataRepository,
  createLaunchBoxRepository
} from '../database';
import { registerMetadataIpc } from '../ipc/metadata-ipc';
import { ImageCache } from '../components/images';
import { HttpClient } from '../components/http/http-client';
import { MetadataService } from '../metadata';
import { LaunchBoxCatalogueImporter } from '../metadata/launchbox/launchbox-catalogue-importer';
import {
  LaunchBoxCatalogueUpdater,
  MAX_LAUNCHBOX_ARCHIVE_BYTES
} from '../metadata/launchbox/launchbox-catalogue-updater';
import { MAX_LAUNCHBOX_XML_BYTES } from '../metadata/launchbox/launchbox-xml-reader';
import { LaunchBoxProvider } from '../metadata/launchbox/launchbox-provider';
import { LibretroClient } from '../metadata/libretro/libretro-client';
import { LibretroProvider } from '../metadata/libretro/libretro-provider';
import { registerExportIpc } from '../ipc/export-ipc';
import { ExportService } from '../export';
import { RetroPieExporter } from '../export/retropie/retropie-exporter';
import { SettingsStore } from '../settings/settings-store';
import { registerSettingsIpc } from '../settings/settings-ipc';

export const ARTWORK_PROTOCOL_OPTIONS: Readonly<ImageProtocolOptions> = {
  scheme: 'retro-art',
  hostname: 'cover',
  maxAgeSeconds: 86400
};

function createIdentificationService(repository: IdentificationRepository): IdentificationService {
  const reader = new FingerprintReader();
  const archives = createArchiveReader({
    maxArchiveBytes: Number.MAX_SAFE_INTEGER,
    maxEntryBytes: MAX_ROM_BYTES
  });
  const fingerprints = new RomFingerprintReader([
    new DirectRomFingerprint(repository, reader),
    new ArchivedRomFingerprint(archives, reader)
  ]);
  return new IdentificationService(repository, fingerprints, new DatReader());
}

/** One construction path for both the packaged smoke check and normal startup. */
export function createCore(root: string) {
  const databasePath = path.join(root, 'library.sqlite');
  const database = openDatabase(databasePath);
  try {
    const collections = createCollectionRepository(database);
    const metadata = createMetadataRepository(database);
    const library = new FileSystemLibraryService({
      collections,
      roms: createRomRepository(database),
      systemOverrides: metadata
    });
    const settings = new SettingsStore(path.join(root, 'settings.json'));
    const artwork = new ImageCache(path.join(root, 'artwork'), {
      maxImageBytes: 5 * 1024 * 1024,
      retentionMs: 7 * 24 * 60 * 60 * 1000,
      temporaryRetentionMs: 24 * 60 * 60 * 1000
    });
    registerLibraryIpc(library);
    registerIdentificationIpc(createIdentificationService(createIdentificationRepository(database)), library);
    registerSettingsIpc(settings, databasePath, artwork, metadata);
    return { database, library, metadata, settings, artwork };
  } catch (error) {
    database.close();
    throw error;
  }
}

export function registerDesktopFeatures(core: ReturnType<typeof createCore>): void {
  const { database, library, metadata, artwork } = core;
  const http = new HttpClient();
  const catalogue = createLaunchBoxRepository(database);
  const metadataService = new MetadataService(metadata, new LaunchBoxProvider(catalogue));
  // Downloaded metadata must use the restricted reader without external fallback.
  const catalogueArchives = createRestrictedArchiveReader({
    maxArchiveBytes: MAX_LAUNCHBOX_ARCHIVE_BYTES,
    maxEntryBytes: MAX_LAUNCHBOX_XML_BYTES
  });
  const launchBox = new LaunchBoxCatalogueUpdater(
    new LaunchBoxCatalogueImporter(catalogue),
    catalogueArchives,
    http
  );
  const libretro = new LibretroProvider(artwork, new LibretroClient(http));
  registerMetadataIpc({ metadata: metadataService, artwork: libretro, launchBox });
  registerExportIpc(new ExportService(library, new RetroPieExporter(artwork)));
  registerImageProtocol(artwork, ARTWORK_PROTOCOL_OPTIONS);
}
