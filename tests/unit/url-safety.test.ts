import { describe, expect, test } from 'bun:test';
import { assertSafePublicUrl, isPrivateHost, validateHttpUrl } from '../../src/utils/url-safety';

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

  // IPv4-mapped IPv6 — hex form (WHATWG URL normalizes dotted to hex)
  test('detects IPv4-mapped IPv6 loopback in hex form via isPrivateHost', () => {
    // ::ffff:7f00:1 == ::ffff:127.0.0.1
    expect(isPrivateHost('::ffff:7f00:1')).toBe(true);
    // dotted form should still work
    expect(isPrivateHost('::ffff:127.0.0.1')).toBe(true);
  });

  test('detects IPv4-mapped IPv6 loopback in hex form via validateHttpUrl', () => {
    // WHATWG URL normalizes [::ffff:127.0.0.1] → [::ffff:7f00:1]
    expect(validateHttpUrl('http://[::ffff:127.0.0.1]/').safe).toBe(false);
    expect(validateHttpUrl('http://[::ffff:7f00:1]/').safe).toBe(false);
  });

  test('detects IPv4-mapped IPv6 loopback via assertSafePublicUrl (IP literal, no DNS)', async () => {
    expect((await assertSafePublicUrl('http://[::ffff:127.0.0.1]/')).safe).toBe(false);
    expect((await assertSafePublicUrl('http://[::ffff:7f00:1]/')).safe).toBe(false);
  });

  test('detects IPv4-mapped IPv6 link-local (cloud metadata) via isPrivateHost', () => {
    // ::ffff:a9fe:a9fe == ::ffff:169.254.169.254
    expect(isPrivateHost('::ffff:a9fe:a9fe')).toBe(true);
    expect(isPrivateHost('::ffff:169.254.169.254')).toBe(true);
  });

  test('detects IPv4-mapped IPv6 link-local via validateHttpUrl', () => {
    expect(validateHttpUrl('http://[::ffff:a9fe:a9fe]/').safe).toBe(false);
    expect(validateHttpUrl('http://[::ffff:169.254.169.254]/').safe).toBe(false);
  });

  test('detects IPv4-mapped IPv6 private (10.x) via isPrivateHost', () => {
    // ::ffff:0a00:0001 == ::ffff:10.0.0.1
    expect(isPrivateHost('::ffff:a00:1')).toBe(true);
    expect(isPrivateHost('::ffff:10.0.0.1')).toBe(true);
  });

  test('detects IPv4-mapped IPv6 private (10.x) via validateHttpUrl', () => {
    expect(validateHttpUrl('http://[::ffff:a00:1]/').safe).toBe(false);
    expect(validateHttpUrl('http://[::ffff:10.0.0.1]/').safe).toBe(false);
  });

  test('allows IPv4-mapped IPv6 public address (8.8.8.8) — must not over-block', () => {
    // ::ffff:808:808 == ::ffff:8.8.8.8
    expect(isPrivateHost('::ffff:808:808')).toBe(false);
    expect(isPrivateHost('::ffff:8.8.8.8')).toBe(false);
    expect(validateHttpUrl('http://[::ffff:808:808]/').safe).toBe(true);
    expect(validateHttpUrl('http://[::ffff:8.8.8.8]/').safe).toBe(true);
  });

  test('allows IPv4-mapped IPv6 public address via assertSafePublicUrl (IP literal)', async () => {
    expect((await assertSafePublicUrl('http://[::ffff:808:808]/')).safe).toBe(true);
  });

  test('detects NAT64 loopback (64:ff9b::7f00:1) via isPrivateHost', () => {
    // 64:ff9b::7f00:1 maps to IPv4 127.0.0.1
    expect(isPrivateHost('64:ff9b::7f00:1')).toBe(true);
  });

  test('detects NAT64 loopback via validateHttpUrl', () => {
    expect(validateHttpUrl('http://[64:ff9b::7f00:1]/').safe).toBe(false);
  });

  test('detects NAT64 loopback via assertSafePublicUrl (IP literal)', async () => {
    expect((await assertSafePublicUrl('http://[64:ff9b::7f00:1]/')).safe).toBe(false);
  });
});
