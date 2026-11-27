import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StreamSizeVerifier } from '../../src/main/components/streams/stream-size-verifier';

const errors = {
  invalidSize: 'Invalid size',
  invalidChunk: 'Invalid chunk',
  oversized: 'Too many bytes',
  truncated: 'Too few bytes'
};

test('stream size verifier accepts exact byte counts across multiple chunks', () => {
  const size = new StreamSizeVerifier(3, errors);
  const first = Buffer.from('a');
  assert.equal(size.accept(first), first);
  assert.equal(size.size, 1);
  size.accept(new Uint8Array([2, 3]));
  assert.equal(size.size, 3);
  size.assertComplete();
  new StreamSizeVerifier(0, errors).assertComplete();
});

test('stream size verifier rejects malformed, excessive and incomplete input', () => {
  for (const invalid of [-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => new StreamSizeVerifier(invalid, errors), /Invalid size/);
  }
  const size = new StreamSizeVerifier(2, errors);
  assert.throws(() => size.accept('a'), /Invalid chunk/);
  size.accept(Buffer.from('a'));
  assert.throws(() => size.accept(Buffer.from('bc')), /Too many bytes/);
  assert.equal(size.size, 1);
  assert.throws(() => size.assertComplete(), /Too few bytes/);
  size.accept(Buffer.from('b'));
  size.assertComplete();
});
