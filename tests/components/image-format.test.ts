import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  createImageId,
  detectImageFormat,
  ImageValidationError,
  isImageId,
  validateImage
} from '../../src/main/components/images';

const samples = [
  { bytes: Buffer.from([0xff, 0xd8, 0xff, 0x01]), extension: 'jpg', mime: 'image/jpeg' },
  { bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), extension: 'png', mime: 'image/png' },
  { bytes: Buffer.from('RIFF\x04\x00\x00\x00WEBP'), extension: 'webp', mime: 'image/webp' }
];

test('image format detection uses supported signatures and returns the MIME type', () => {
  for (const { bytes, extension, mime } of samples) {
    assert.deepEqual(detectImageFormat(bytes), { extension, mime });
    assert.deepEqual(validateImage(bytes, bytes.length), { extension, mime });
  }
  for (const bytes of [Buffer.alloc(0), Buffer.from([0xff, 0xd8]), Buffer.from('RIFF'), Buffer.from('bad')]) {
    assert.equal(detectImageFormat(bytes), null);
  }
});

test('image identifiers preserve SHA-256 content addresses and refuse invalid path components', () => {
  for (const { bytes, extension } of samples) {
    const id = createImageId(bytes);
    assert.equal(id, `${createHash('sha256').update(bytes).digest('hex')}.${extension}`);
    assert.equal(isImageId(id), true);
  }
  assert.equal(isImageId(`${'a'.repeat(64)}.jpg`), true);
  for (const id of [null, '../../evil.jpg', `${'A'.repeat(64)}.png`, `${'a'.repeat(64)}.gif`]) {
    assert.equal(isImageId(id), false);
  }
  assert.throws(() => createImageId(Buffer.from('bad')), /supported image/);
});

test('image size and format errors are distinct from invalid configuration', () => {
  const { bytes } = samples[0];
  assert.throws(
    () => validateImage(bytes, bytes.length - 1),
    (error: unknown) => error instanceof ImageValidationError && error.reason === 'too-large'
  );
  assert.throws(
    () => validateImage(Buffer.from('bad'), 10),
    (error: unknown) => error instanceof ImageValidationError && error.reason === 'unsupported-format'
  );
  assert.throws(() => validateImage(bytes, NaN), /Invalid image size limit/);
});
