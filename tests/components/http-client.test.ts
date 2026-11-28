import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { HttpClient, ResponseBodyError } from '../../src/main/components/http/http-client';

function isOversized(error: unknown): boolean {
  return error instanceof ResponseBodyError && error.reason === 'too-large';
}

test('bounded HTTP reads reject declared and observed oversize content and missing bodies', async () => {
  const client = new HttpClient();
  assert.deepEqual(await client.readBytes(new Response('abc'), 3), Buffer.from('abc'));
  await assert.rejects(
    client.readBytes(new Response('a', { headers: { 'content-length': '4' } }), 3),
    isOversized
  );
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(4));
    },
    cancel() {
      cancelled = true;
    }
  });
  await assert.rejects(client.readBytes(new Response(body), 3), isOversized);
  assert.equal(cancelled, true);
  await assert.rejects(
    client.readBytes(new Response(null), 3),
    (error: unknown) => error instanceof ResponseBodyError && error.reason === 'missing'
  );
});

test('bounded streaming downloads respect actual limits and exclusive creation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rh-http-component-'));
  try {
    const client = new HttpClient();
    const file = path.join(root, 'download');
    assert.equal(await client.download(new Response('abc'), file, { maxBytes: 3 }), 3);
    assert.equal(await readFile(file, 'utf8'), 'abc');
    await assert.rejects(client.download(new Response('def'), file, { maxBytes: 3 }), /EEXIST/);
    assert.equal(await readFile(file, 'utf8'), 'abc');
    await assert.rejects(
      client.download(new Response('long'), path.join(root, 'oversize'), { maxBytes: 3 }),
      isOversized
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
