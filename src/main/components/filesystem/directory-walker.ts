import { lstat, opendir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { throwIfCancelled } from '../../utils/cancellation';
import { assertUnredirectedPath } from './paths';

export interface DirectoryListing {
  directory: string;
  files: readonly string[];
}

export interface WalkOptions {
  signal?: AbortSignal;
  onWarning?: (filename: string, error: unknown) => void;
  onDirectoryFinished?: (directory: string) => void;
}

type PendingDirectory = { directory: string; depth: number };
type DirectoryContents = DirectoryListing & { subdirectories: string[] };

/** Read-only depth-first traversal; skip hidden child directories and links. */
export class DirectoryWalker {
  constructor(private readonly maxDepth: number) {}

  public async resolveRoot(folder: string): Promise<string> {
    const root = await realpath(folder);
    if (!(await lstat(root)).isDirectory()) {
      throw new Error('Please choose a directory.');
    }
    return root;
  }

  public async *walk(root: string, options: WalkOptions = {}): AsyncGenerator<DirectoryListing> {
    const pending: PendingDirectory[] = [{ directory: root, depth: 0 }];
    while (pending.length) {
      throwIfCancelled(options.signal);
      const current = pending.pop()!;
      const contents = await this.readOrSkip(root, current.directory, options);
      if (contents) {
        yield { directory: contents.directory, files: contents.files };
        for (const child of this.childDirectories(current, contents.subdirectories, options)) {
          pending.push(child);
        }
      }
      options.onDirectoryFinished?.(current.directory);
    }
    throwIfCancelled(options.signal);
  }

  private async readOrSkip(
    root: string,
    directory: string,
    options: WalkOptions
  ): Promise<DirectoryContents | null> {
    try {
      return await this.readDirectory(root, directory, options.signal);
    } catch (error) {
      throwIfCancelled(options.signal);
      if (directory === root) {
        throw error;
      }
      // A partial scan must report unreadable children to protect saved inventory.
      options.onWarning?.(directory, error);
      return null;
    }
  }

  private async readDirectory(
    root: string,
    directory: string,
    signal?: AbortSignal
  ): Promise<DirectoryContents> {
    await assertUnredirectedPath(root, directory);
    if (!(await lstat(directory)).isDirectory()) {
      throw new Error('Not a regular directory.');
    }
    const files: string[] = [];
    const subdirectories: string[] = [];
    for await (const entry of await opendir(directory)) {
      throwIfCancelled(signal);
      if (entry.isSymbolicLink()) {
        continue;
      }
      const filename = path.join(directory, entry.name);
      if (entry.isFile()) {
        files.push(filename);
      } else if (entry.isDirectory()) {
        subdirectories.push(filename);
      }
    }
    await assertUnredirectedPath(root, directory);
    return { directory, files, subdirectories };
  }

  private *childDirectories(
    current: PendingDirectory,
    children: readonly string[],
    options: WalkOptions
  ): Generator<PendingDirectory> {
    for (const directory of children) {
      throwIfCancelled(options.signal);
      if (current.depth >= this.maxDepth) {
        options.onWarning?.(directory, new Error('Maximum scan depth reached.'));
        continue;
      }
      if (!path.basename(directory).startsWith('.')) {
        yield { directory, depth: current.depth + 1 };
      }
    }
  }
}
