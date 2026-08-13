import JSZip from 'jszip';
import { basename, posix } from 'node:path';
import type { AgentType, GeneratedArtifact } from '../types/index.js';
import { normalizeSkillName } from '../format/frontmatter.js';

export interface ZipPackage {
  buffer: Buffer;
  filename: string;
  entries: string[];
}

/**
 * 将内存生成物打成可移植 ZIP。只使用相对安全路径，拒绝绝对路径和 .. 穿越。
 */
export async function createArtifactZip(
  artifacts: GeneratedArtifact[],
  agentType: AgentType,
): Promise<ZipPackage> {
  if (!artifacts.length) throw new Error('没有可打包的生成物');

  const entries = artifacts.map((item) => ({
    path: toSafeArchivePath(item.path),
    content: item.content,
  }));
  if (new Set(entries.map((item) => item.path)).size !== entries.length) {
    throw new Error('生成物 ZIP 路径重复');
  }

  const zip = new JSZip();
  for (const entry of entries) {
    zip.file(entry.path, entry.content, { binary: false });
  }
  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    platform: 'UNIX',
  });
  return {
    buffer,
    filename: `${resolvePackageName(artifacts, agentType)}.zip`,
    entries: entries.map((item) => item.path),
  };
}

function toSafeArchivePath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[a-zA-Z]:\//.test(normalized)
  ) {
    throw new Error(`生成物路径不能打包: ${path}`);
  }
  const safe = posix.normalize(normalized);
  if (!safe || safe === '.' || safe === '..' || safe.startsWith('../')) {
    throw new Error(`生成物路径不安全: ${path}`);
  }
  return safe;
}

function resolvePackageName(
  artifacts: GeneratedArtifact[],
  agentType: AgentType,
): string {
  const primary = artifacts[0];
  const metadataName = primary.content.match(
    /^---\r?\n[\s\S]*?^name:\s*([^\r\n]+)$/m,
  )?.[1];
  const title = primary.content.match(/^#\s+(.+)$/m)?.[1];
  const parent = primary.path.replaceAll('\\', '/').split('/').slice(-2, -1)[0];
  const source =
    metadataName ||
    title ||
    parent ||
    basename(primary.path, posix.extname(primary.path));
  return `${normalizeSkillName(source)}-${agentType}-skill`;
}
