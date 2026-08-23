import { randomBytes } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const MAX_ROLLBACK_BYTES = 100 * 1024 * 1024;

export interface AtomicFileWrite {
  path: string;
  content: string;
  mode?: number;
}

/** 同目录临时文件 + rename，避免崩溃时留下半文件。 */
export async function writeFileAtomic(
  path: string,
  content: string | Uint8Array,
  mode?: number,
): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tempPath = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(
      tempPath,
      content,
      typeof content === 'string' ? { encoding: 'utf-8', mode } : { mode },
    );
    if (mode !== undefined) await chmod(tempPath, mode);
    await rename(tempPath, path);
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }
}

/**
 * 批量原子写入：先预检并快照全部目标；任一写入失败时恢复已改动文件。
 * 单文件仍由同目录临时文件 + rename 保证不会留下半文件。
 */
export async function writeFilesAtomic(
  files: readonly AtomicFileWrite[],
): Promise<void> {
  const seen = new Set<string>();
  const snapshots: Array<{
    path: string;
    content?: Buffer;
    mode?: number;
  }> = [];
  let rollbackBytes = 0;

  for (const file of files) {
    const absolutePath = resolve(file.path);
    if (seen.has(absolutePath)) {
      throw new Error(`批量写入包含重复路径: ${file.path}`);
    }
    seen.add(absolutePath);
    try {
      const stat = await lstat(absolutePath);
      if (!stat.isFile()) {
        throw new Error(`目标路径不是普通文件: ${file.path}`);
      }
      rollbackBytes += stat.size;
      if (rollbackBytes > MAX_ROLLBACK_BYTES) {
        throw new Error('目标文件回滚快照总量超过 100 MiB，已阻止批量覆盖');
      }
      snapshots.push({
        path: absolutePath,
        content: await readFile(absolutePath),
        mode: stat.mode & 0o777,
      });
    } catch (error: unknown) {
      if (getErrorCode(error) !== 'ENOENT') throw error;
      snapshots.push({ path: absolutePath });
    }
  }

  let written = 0;
  try {
    for (const [index, file] of files.entries()) {
      await writeFileAtomic(
        snapshots[index].path,
        file.content,
        file.mode ?? snapshots[index].mode,
      );
      written += 1;
    }
  } catch (error: unknown) {
    const rollbackErrors: unknown[] = [];
    for (let index = written - 1; index >= 0; index -= 1) {
      const snapshot = snapshots[index];
      try {
        if (snapshot.content) {
          await writeFileAtomic(snapshot.path, snapshot.content, snapshot.mode);
          if (snapshot.mode !== undefined)
            await chmod(snapshot.path, snapshot.mode);
        } else {
          await unlink(snapshot.path).catch((unlinkError: unknown) => {
            if (getErrorCode(unlinkError) !== 'ENOENT') throw unlinkError;
          });
        }
      } catch (rollbackError: unknown) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        '批量写入失败且部分文件回滚失败',
        { cause: error },
      );
    }
    throw error;
  }
}

function getErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : undefined;
}
