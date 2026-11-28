import type { Span } from '../xml/xml-editor';
import type { GameListEntry } from './gamelist-entry';
import { parseGameList } from './gamelist-parser';
import type { GameListRecord, GameListStructure } from './gamelist-record';
import { serializeGameList } from './gamelist-serializer';

export class GameListDocument {
  private constructor(
    private readonly source: string,
    private parsedStructure?: GameListStructure
  ) {}

  public static parse(xml: string): GameListDocument {
    return new GameListDocument(xml, parseGameList(xml));
  }

  public static fromEntries(entries: readonly GameListEntry[]): GameListDocument {
    return new GameListDocument(serializeGameList(entries));
  }

  public toXml(): string {
    return this.source;
  }

  public sourceTextFor(span: Span): string {
    return this.source.slice(span.start, span.end);
  }

  public get records(): readonly GameListRecord[] {
    return this.structure.records;
  }

  public get structure(): GameListStructure {
    // New files do not need a parse pass until a consumer asks for their spans.
    return (this.parsedStructure ??= parseGameList(this.source));
  }
}
