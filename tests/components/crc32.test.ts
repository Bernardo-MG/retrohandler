import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Crc32 } from '../../src/main/components/hashing/crc32';

test('CRC32 computes the standard checksum across multiple chunks', () => {
  const checksum = new Crc32();
  checksum.update(Buffer.from('1234'));
  checksum.update(Buffer.from('56789'));
  assert.equal(checksum.hex(), 'cbf43926');
});
