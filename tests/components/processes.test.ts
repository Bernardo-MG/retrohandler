import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { ProcessDiagnostics } from '../../src/main/components/processes/process-diagnostics';
import { ProcessOutput } from '../../src/main/components/processes/process-output';
import { stopProcess, waitForExit } from '../../src/main/components/processes/process-lifecycle';

function run(script: string) {
  return spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
}

test('process output limits bytes, including multibyte text', async () => {
  const child = run("process.stdout.write('éé')");
  const output = new ProcessOutput(child, 4);
  assert.equal(await waitForExit(child), 0);
  assert.equal(output.text, 'éé');
  assert.equal(output.exceededLimit, false);

  const oversized = run("process.stdout.write('éé'); setInterval(() => {}, 1000)");
  const limited = new ProcessOutput(oversized, 3);
  try {
    await waitForExit(oversized);
    assert.equal(limited.exceededLimit, true);
    assert.equal(limited.text, '');
  } finally {
    stopProcess(oversized);
  }
});

test('process diagnostics retain a bounded tail and summary', () => {
  const stream = new PassThrough();
  const diagnostics = new ProcessDiagnostics(stream, 5, 3);
  stream.write('abcdef');
  stream.end('gh');
  assert.equal(diagnostics.summary, 'def');
});
