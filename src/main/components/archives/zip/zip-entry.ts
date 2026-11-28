export interface ZipEntry {
  start: number;
  compressed: number;
  size: number;
  crc: number;
  method: number;
}

export type CentralDirectory = {
  offset: number;
  size: number;
  entries: number;
};

export type DirectoryEntry = {
  name: string;
  flags: number;
  method: number;
  crc: number;
  compressed: number;
  size: number;
  offset: number;
  end: number;
};
