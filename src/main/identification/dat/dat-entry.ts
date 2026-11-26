export interface DatEntry {
  game: string;
  file: string;
  size: number;
  crc32: string | null;
  md5: string | null;
  sha1: string | null;
}

export interface ParsedDat {
  name: string;
  entries: DatEntry[];
}
