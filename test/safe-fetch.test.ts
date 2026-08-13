import { describe, expect, it } from 'vitest';
import { isPublicIp, validatePublicHttpUrl } from '../src/utils/safe-fetch.js';

describe('安全远程抓取校验', () => {
  it('允许公网 HTTP(S) URL', () => {
    expect(validatePublicHttpUrl('https://example.com/docs').hostname).toBe(
      'example.com',
    );
  });

  it('拒绝本机、私网和云元数据地址', () => {
    for (const url of [
      'http://localhost:3000',
      'http://127.0.0.1',
      'http://10.0.0.1',
      'http://192.168.1.1',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]',
    ]) {
      expect(() => validatePublicHttpUrl(url)).toThrow('私有网络');
    }
  });

  it('拒绝非 HTTP 协议及认证信息', () => {
    expect(() => validatePublicHttpUrl('file:///etc/passwd')).toThrow(
      'HTTP(S)',
    );
    expect(() =>
      validatePublicHttpUrl('https://user:pass@example.com'),
    ).toThrow('认证信息');
  });

  it('正确识别公网和保留 IP', () => {
    expect(isPublicIp('8.8.8.8')).toBe(true);
    expect(isPublicIp('1.1.1.1')).toBe(true);
    expect(isPublicIp('127.0.0.1')).toBe(false);
    expect(isPublicIp('203.0.113.1')).toBe(false);
    expect(isPublicIp('::1')).toBe(false);
  });
});
