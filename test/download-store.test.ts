import { describe, expect, it, vi } from 'vitest';
import { DownloadStore } from '../src/utils/download-store.js';

const archive = (name: string, size = 10) => ({
  buffer: Buffer.alloc(size),
  filename: `${name}.zip`,
  entries: [`${name}.md`],
});

describe('DownloadStore', () => {
  it('生成不可猜测票据并可读取 ZIP', () => {
    const store = new DownloadStore();
    const ticket = store.add(archive('skill'));
    expect(ticket.id).toMatch(/^[a-zA-Z0-9_-]{32}$/);
    expect(store.get(ticket.id)?.filename).toBe('skill.zip');
  });

  it('过期后自动失效', () => {
    vi.useFakeTimers();
    const store = new DownloadStore({ ttlMs: 100 });
    const ticket = store.add(archive('skill'));
    vi.advanceTimersByTime(101);
    expect(store.get(ticket.id)).toBeUndefined();
    vi.useRealTimers();
  });

  it('超过条目上限时淘汰最早条目', () => {
    const store = new DownloadStore({ maxEntries: 1 });
    const first = store.add(archive('first'));
    const second = store.add(archive('second'));
    expect(store.get(first.id)).toBeUndefined();
    expect(store.get(second.id)).toBeDefined();
  });
});
