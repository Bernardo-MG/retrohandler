function crcTableEntry(index: number): number {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) {
    crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return crc >>> 0;
}

const table = Uint32Array.from({ length: 256 }, (_, index) => crcTableEntry(index));

/** Incremental ZIP/ROM CRC32, without retaining streamed content. */
export class Crc32 {
  private checksum = 0xffffffff;

  public update(bytes: Uint8Array): void {
    for (const byte of bytes) {
      this.checksum = (this.checksum >>> 8) ^ table[(this.checksum ^ byte) & 255];
    }
  }

  public digest(): number {
    return (this.checksum ^ 0xffffffff) >>> 0;
  }

  public hex(): string {
    return this.digest().toString(16).padStart(8, '0');
  }
}
