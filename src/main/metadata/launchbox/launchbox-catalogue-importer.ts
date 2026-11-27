import type { LaunchBoxGame, LaunchBoxImportRepository } from '../../contracts/persistence';
import { LaunchBoxXmlReader, assertImportNotCancelled } from './launchbox-xml-reader';

export type ImportOptions = {
  signal?: AbortSignal;
  onProgress?: (count: number) => void;
};

/** Owns staging, publication and rollback. XML parsing is independent of persistence. */
export class LaunchBoxCatalogueImporter {
  constructor(
    private readonly repository: LaunchBoxImportRepository,
    private readonly reader = new LaunchBoxXmlReader()
  ) {}

  public async importFile(file: string, options: ImportOptions = {}): Promise<number> {
    this.assertRepositoryAvailable();
    const records = await this.reader.open(file, options.signal);
    this.repository.beginLaunchBoxImport();
    try {
      const count = await this.stageRecords(records, options);
      if (!count) {
        throw new Error('No LaunchBox games found. Select the extracted Metadata.xml, not the ZIP archive.');
      }
      assertImportNotCancelled(options.signal);
      options.onProgress?.(count);
      assertImportNotCancelled(options.signal);
      return this.repository.finishLaunchBoxImport();
    } catch (error) {
      this.repository.abortLaunchBoxImport();
      throw error;
    }
  }

  private async stageRecords(records: AsyncIterable<LaunchBoxGame>, options: ImportOptions): Promise<number> {
    let count = 0;
    for await (const game of records) {
      assertImportNotCancelled(options.signal);
      this.repository.addLaunchBoxGame(game);
      count++;
      if (count % 500 === 0) {
        options.onProgress?.(count);
      }
    }
    return count;
  }

  private assertRepositoryAvailable(): void {
    const { beginLaunchBoxImport, addLaunchBoxGame, finishLaunchBoxImport, abortLaunchBoxImport } =
      this.repository;
    if (!beginLaunchBoxImport || !addLaunchBoxGame || !finishLaunchBoxImport || !abortLaunchBoxImport) {
      throw new Error('LaunchBox import storage unavailable.');
    }
  }
}
