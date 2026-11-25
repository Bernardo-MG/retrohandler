import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { PassThrough, type Readable } from 'node:stream';

export interface ArchiveMember { name: string; size: number; directory: boolean; }
export interface ArchiveReader {
  list(filename: string, signal?: AbortSignal): Promise<ArchiveMember[]>;
  open(filename: string, member: string, signal?: AbortSignal): Readable;
}

const MAX_LISTING_BYTES = 16 * 1024 * 1024;
const MAX_ARCHIVE_MEMBERS = 10000;
export const MAX_ROM_BYTES = 1024 * 1024 * 1024; // one GiB per extracted ROM
const romExtensions = new Set(['.nes','.fds','.sfc','.smc','.gb','.gbc','.gba','.n64','.z64','.v64','.nds','.md','.gen','.smd','.sms','.gg','.a26','.a78','.pce','.ngp','.ngc','.ws','.wsc','.rom']);

export function selectRomMember(members: ArchiveMember[]): ArchiveMember | null {
  if (members.length > MAX_ARCHIVE_MEMBERS) throw new Error('Too many archive entries.');
  const candidates = members.filter(member => !member.directory && romExtensions.has(path.extname(member.name).toLowerCase()));
  // One container is one library row; never claim it represents a single game if it contains several ROMs.
  if (candidates.length !== 1) return null;
  const member = candidates[0];
  if (!Number.isSafeInteger(member.size) || member.size < 0 || member.size > MAX_ROM_BYTES) throw new Error('ROM member exceeds size limit.');
  return member;
}

export function parse7ZipListing(output: string): ArchiveMember[] {
  const divider = /^----------\r?$/m.exec(output);
  if (!divider) throw new Error('Invalid 7-Zip archive listing.');
  const entries: ArchiveMember[] = [];
  for (const block of output.slice(divider.index + divider[0].length).split(/\r?\n\s*\r?\n/)) {
    const values = new Map<string, string>();
    for (const line of block.split(/\r?\n/)) {
      const split = line.indexOf(' = ');
      if (split !== -1) values.set(line.slice(0, split).trim(), line.slice(split + 3));
    }
    if (!values.has('Path')) continue;
    const rawSize = values.get('Size');
    const size = Number(rawSize);
    if (!/^[0-9]+$/.test(rawSize ?? '') || !Number.isSafeInteger(size) || size < 0) throw new Error('Archive has invalid member size.');
    entries.push({ name: values.get('Path')!, size, directory: values.get('Folder') === '+' });
    if (entries.length > MAX_ARCHIVE_MEMBERS) throw new Error('Too many archive entries.');
  }
  return entries;
}

function sevenZipExecutable(): string {
  const chosen = process.env.RETROHANDLER_7ZIP;
  if (chosen) return chosen;
  for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) {
    if (base) {
      const candidate = path.join(base, '7-Zip', '7z.exe');
      if (existsSync(candidate)) return candidate;
    }
  }
  return '7z'; // PATH fallback; 7zz may be configured with RETROHANDLER_7ZIP
}

export class SevenZipReader implements ArchiveReader {
  async list(filename: string, signal?: AbortSignal): Promise<ArchiveMember[]> {
    const child = spawn(sevenZipExecutable(), ['l', '-slt', '-bd', '--', filename], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], signal });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; if (stdout.length > MAX_LISTING_BYTES) child.kill(); });
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-2048); });
    const code = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (exitCode) => resolve(exitCode ?? -1));
    });
    if (signal?.aborted) throw Object.assign(new Error('Identification cancelled.'), { name: 'AbortError' });
    if (stdout.length > MAX_LISTING_BYTES) throw new Error('Archive listing exceeds limit.');
    if (code !== 0) throw new Error(`7-Zip cannot read archive (${code}): ${stderr.slice(0, 300)}`);
    return parse7ZipListing(stdout);
  }

  open(filename: string, member: string, signal?: AbortSignal): Readable {
    // Disable wildcard expansion so an archive member is matched literally.
    const child = spawn(sevenZipExecutable(), ['x', '-so', '-bd', '-y', '-spd', '--', filename, member],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], signal });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-2048); });
    const out = new PassThrough();
    child.stdout.pipe(out, { end: false });
    child.on('error', error => out.destroy(error));
    child.once('close', code => {
      if (code === 0) out.end();
      else out.destroy(new Error(`7-Zip extraction failed (${code}): ${stderr.slice(0, 300)}`));
    });
    out.once('close', () => { if (child.exitCode === null && !child.killed) child.kill(); });
    return out;
  }
}
