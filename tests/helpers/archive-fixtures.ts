import { deflateRawSync } from 'node:zlib';

interface ArchiveFixtureOptions {
  method?: number;
  compressed?: Buffer;
  checksum?: number;
  centralChecksum?: number;
  localName?: string;
}

// Keep fixture checksums independent of the production checksum implementation.
function crc32(bytes: Buffer): number {
  let checksum = 0xffffffff;
  for (const byte of bytes) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0);
    }
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

/** Build a single-entry classic archive, optionally exercising invalid entry metadata. */
export function createArchiveFixture(
  content: string | Buffer,
  entryName: string,
  options: ArchiveFixtureOptions = {}
): Buffer {
  const data = Buffer.from(content);
  const name = Buffer.from(entryName);
  const localName = Buffer.from(options.localName ?? entryName);
  const method = options.method ?? 8;
  const compressed = options.compressed ?? (method === 8 ? deflateRawSync(data) : data);
  const checksum = options.checksum ?? crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(localName.length, 26);
  const directory = Buffer.alloc(46);
  directory.writeUInt32LE(0x02014b50, 0);
  directory.writeUInt16LE(20, 4);
  directory.writeUInt16LE(20, 6);
  directory.writeUInt16LE(method, 10);
  directory.writeUInt32LE(options.centralChecksum ?? checksum, 16);
  directory.writeUInt32LE(compressed.length, 20);
  directory.writeUInt32LE(data.length, 24);
  directory.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(directory.length + name.length, 12);
  end.writeUInt32LE(local.length + localName.length + compressed.length, 16);
  return Buffer.concat([local, localName, compressed, directory, name, end]);
}
