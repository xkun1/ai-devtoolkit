import { randomBytes } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** 同目录临时文件 + rename，避免崩溃时留下半文件。 */
export async function writeFileAtomic(
  path: string,
  content: string,
  mode?: number,
): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tempPath = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(tempPath, content, { encoding: 'utf-8', mode });
    await rename(tempPath, path);
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }
}
