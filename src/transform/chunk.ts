/** 长文档语义分块。所有切片首尾相接，保证原文字符不丢失、不重复。 */

export const DEFAULT_CHUNK_CHARS = 24_000;

export interface DocumentChunk {
  index: number;
  start: number;
  end: number;
  content: string;
}

interface Range {
  start: number;
  end: number;
}

/**
 * 优先在 Markdown 标题、段落、行边界处分块，并尽量避开 fenced code block。
 * 极端超长代码块会退化到行边界，以避免单次请求无限膨胀。
 */
export function splitDocument(
  content: string,
  maxChars: number = DEFAULT_CHUNK_CHARS,
): DocumentChunk[] {
  if (!Number.isSafeInteger(maxChars) || maxChars < 1_000) {
    throw new Error('分块大小必须是不小于 1000 的整数');
  }
  if (!content.length) return [];

  const fenceRanges = findFenceRanges(content);
  const chunks: DocumentChunk[] = [];
  let start = 0;

  while (start < content.length) {
    const hardEnd = Math.min(start + maxChars, content.length);
    let end = hardEnd;

    if (hardEnd < content.length) {
      const minEnd = start + Math.floor(maxChars * 0.55);
      const enclosingFence = findEnclosingRange(hardEnd, fenceRanges);
      if (
        enclosingFence &&
        enclosingFence.end - start <= Math.ceil(maxChars * 1.5)
      ) {
        // 允许适度超出目标大小，以完整保留常规代码块。
        end = enclosingFence.end;
      } else {
        end =
          findSafeBoundary(content, start, minEnd, hardEnd, fenceRanges) ??
          findLineBoundary(content, start, hardEnd) ??
          hardEnd;
      }
      end = avoidBrokenSurrogate(content, end);
      if (end <= start) end = hardEnd;
    }

    chunks.push({
      index: chunks.length,
      start,
      end,
      content: content.slice(start, end),
    });
    start = end;
  }

  return chunks;
}

function findSafeBoundary(
  content: string,
  start: number,
  minEnd: number,
  hardEnd: number,
  fenceRanges: Range[],
): number | undefined {
  const window = content.slice(minEnd, hardEnd);
  const patterns = [/\n(?=#{1,6}\s)/g, /\n\s*\n/g, /\n/g, /\s/g];

  for (const pattern of patterns) {
    const matches = [...window.matchAll(pattern)];
    for (let i = matches.length - 1; i >= 0; i--) {
      const match = matches[i];
      const boundary = minEnd + (match.index ?? 0) + match[0].length;
      if (
        boundary > start &&
        boundary <= hardEnd &&
        !isInsideRange(boundary, fenceRanges)
      ) {
        return boundary;
      }
    }
  }
  return undefined;
}

function findLineBoundary(
  content: string,
  start: number,
  hardEnd: number,
): number | undefined {
  const newline = content.lastIndexOf('\n', hardEnd - 1);
  return newline > start ? newline + 1 : undefined;
}

function findFenceRanges(content: string): Range[] {
  const ranges: Range[] = [];
  const marker = /^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/gm;
  let open: { char: string; length: number; start: number } | undefined;
  let match: RegExpExecArray | null;

  while ((match = marker.exec(content))) {
    const token = match[1];
    if (!open) {
      open = { char: token[0], length: token.length, start: match.index };
      continue;
    }
    if (token[0] === open.char && token.length >= open.length) {
      ranges.push({ start: open.start, end: marker.lastIndex });
      open = undefined;
    }
  }
  if (open) ranges.push({ start: open.start, end: content.length });
  return ranges;
}

function isInsideRange(position: number, ranges: Range[]): boolean {
  return ranges.some((range) => position > range.start && position < range.end);
}

function findEnclosingRange(
  position: number,
  ranges: Range[],
): Range | undefined {
  return ranges.find((range) => position > range.start && position < range.end);
}

function avoidBrokenSurrogate(content: string, end: number): number {
  const current = content.charCodeAt(end);
  const previous = content.charCodeAt(end - 1);
  const splitsPair =
    previous >= 0xd800 &&
    previous <= 0xdbff &&
    current >= 0xdc00 &&
    current <= 0xdfff;
  return splitsPair ? end - 1 : end;
}
