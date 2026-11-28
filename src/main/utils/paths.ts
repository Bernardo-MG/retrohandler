import path from 'node:path';

export const childOf = (parent: string, child: string) => {
  const rel = path.relative(parent, child);
  return !!rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
};
