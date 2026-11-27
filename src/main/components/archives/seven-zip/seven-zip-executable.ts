import { existsSync } from 'node:fs';
import path from 'node:path';

export function resolveSevenZipExecutable(): string {
  const configured = process.env.RETROHANDLER_7ZIP;
  if (configured) {
    return configured;
  }
  for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) {
    if (!base) {
      continue;
    }
    const candidate = path.join(base, '7-Zip', '7z.exe');
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return '7z'; // PATH fallback; 7zz may be configured with RETROHANDLER_7ZIP.
}
