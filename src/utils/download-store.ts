import { randomBytes } from 'node:crypto';
import type { ZipPackage } from './zip.js';

export interface DownloadTicket extends ZipPackage {
  id: string;
  expiresAt: number;
}

export interface DownloadStoreOptions {
  ttlMs?: number;
  maxEntries?: number;
  maxBytes?: number;
}

/** 有界内存下载仓库：短期保存 ZIP，避免把 Base64 塞入生成接口 JSON。 */
export class DownloadStore {
  private readonly entries = new Map<string, DownloadTicket>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly maxBytes: number;

  constructor(options: DownloadStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? 10 * 60_000;
    this.maxEntries = options.maxEntries ?? 20;
    this.maxBytes = options.maxBytes ?? 50 * 1024 * 1024;
    if (this.ttlMs < 1 || this.maxEntries < 1 || this.maxBytes < 1) {
      throw new Error('下载仓库配置必须为正数');
    }
  }

  add(archive: ZipPackage): DownloadTicket {
    this.cleanup();
    if (archive.buffer.length > this.maxBytes) {
      throw new Error('技能包 ZIP 超过下载缓存上限');
    }
    while (
      this.entries.size >= this.maxEntries ||
      this.totalBytes() + archive.buffer.length > this.maxBytes
    ) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.entries.delete(oldest);
    }
    const ticket: DownloadTicket = {
      ...archive,
      id: randomBytes(24).toString('base64url'),
      expiresAt: Date.now() + this.ttlMs,
    };
    this.entries.set(ticket.id, ticket);
    return ticket;
  }

  get(id: string): DownloadTicket | undefined {
    this.cleanup();
    return this.entries.get(id);
  }

  clear(): void {
    this.entries.clear();
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(id);
    }
  }

  private totalBytes(): number {
    let total = 0;
    for (const entry of this.entries.values()) total += entry.buffer.length;
    return total;
  }
}
