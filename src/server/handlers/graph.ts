import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import {
  buildDependencyGraph,
  analyzeImpact,
  generateMermaidGraph,
  formatImpactReport,
} from '../../graph/index.js';
import { HttpError, readBody, serveJSON } from '../http.js';
import { resolveProjectPath } from '../validation.js';

export async function handleGraph(
  req: IncomingMessage,
  res: ServerResponse,
  maxBodyBytes: number,
  projectRoot: string,
): Promise<void> {
  const body =
    req.method === 'POST'
      ? ((await readBody(req, maxBodyBytes)) as {
          projectRoot?: string;
          direction?: 'TD' | 'LR';
        })
      : {};
  if (body.direction !== undefined && !['TD', 'LR'].includes(body.direction)) {
    throw new HttpError(400, 'direction 仅支持 TD 或 LR');
  }
  const root = await resolveProjectPath(projectRoot, body.projectRoot);
  const graph = await buildDependencyGraph({ root });
  const mermaid = generateMermaidGraph(graph, {
    direction: body.direction || 'LR',
  });
  serveJSON(res, 200, {
    graph,
    mermaid,
  });
}

export async function handleImpact(
  req: IncomingMessage,
  res: ServerResponse,
  maxBodyBytes: number,
  projectRoot: string,
): Promise<void> {
  const body = (await readBody(req, maxBodyBytes)) as {
    targetFile?: string;
    projectRoot?: string;
  };
  if (typeof body.targetFile !== 'string' || !body.targetFile.trim()) {
    throw new HttpError(400, '缺少 targetFile 参数');
  }
  if (body.targetFile.length > 10_000) {
    throw new HttpError(400, 'targetFile 参数过长');
  }
  const root = await resolveProjectPath(projectRoot, body.projectRoot);
  const graph = await buildDependencyGraph({ root });
  const result = analyzeImpact(graph, body.targetFile);
  serveJSON(res, 200, {
    result,
    report: formatImpactReport(result),
  });
}

export async function handleReadFile(
  req: IncomingMessage,
  res: ServerResponse,
  maxBodyBytes: number,
  projectRoot: string,
  maxReadableFileBytes: number,
): Promise<void> {
  const body = (await readBody(req, maxBodyBytes)) as {
    path?: string;
  };
  if (typeof body.path !== 'string' || !body.path.trim()) {
    throw new HttpError(400, '缺少 path 参数');
  }
  const absPath = await resolveProjectPath(projectRoot, body.path);
  const fileStat = await stat(absPath);
  if (!fileStat.isFile()) {
    throw new HttpError(400, '仅允许读取普通文件');
  }
  if (fileStat.size > maxReadableFileBytes) {
    throw new HttpError(413, '文件超过源码查看大小限制');
  }
  const content = await readFile(absPath, 'utf-8');
  serveJSON(res, 200, {
    path: body.path,
    content,
    lines: content.split(String.fromCharCode(10)).length,
    size: fileStat.size,
  });
}
