import { describe, expect, test } from 'bun:test';
import { isPrivateHost, validateHttpUrl } from '../../src/utils/url-safety';

describe('url safety', () => {
  test('rejects non-http protocols', () => {
    const result = validateHttpUrl('file:///etc/passwd');

    expect(result.safe).toBe(false);
    expect(result.error).toContain('Invalid URL protocol');
  });

  test('rejects localhost names and loopback addresses', () => {
    expect(validateHttpUrl('http://localhost:3000').safe).toBe(false);
    expect(validateHttpUrl('http://127.0.0.1').safe).toBe(false);
    expect(validateHttpUrl('http://[::1]/').safe).toBe(false);
  });

  test('detects private and metadata IPv4 ranges', () => {
    expect(isPrivateHost('10.0.0.1')).toBe(true);
    expect(isPrivateHost('172.16.0.1')).toBe(true);
    expect(isPrivateHost('192.168.1.1')).toBe(true);
    expect(isPrivateHost('169.254.169.254')).toBe(true);
    expect(isPrivateHost('100.64.0.1')).toBe(true);
  });

  test('detects private IPv6 ranges and IPv4-mapped loopback', () => {
    expect(isPrivateHost('fd00::1')).toBe(true);
    expect(isPrivateHost('fe80::1')).toBe(true);
    expect(isPrivateHost('::ffff:127.0.0.1')).toBe(true);
  });

  test('allows ordinary public URLs before DNS resolution', () => {
    const result = validateHttpUrl('https://example.com/article');

    expect(result.safe).toBe(true);
    expect(result.url?.hostname).toBe('example.com');
  });
});
