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

  // IPv4-compatible IPv6 (::/96) — deprecated form whose low 32 bits are a
  // literal IPv4 address. These previously bypassed the private-range check.
  test('still treats :: and ::1 as private (special cases preserved)', () => {
    expect(isPrivateHost('::')).toBe(true);
    expect(isPrivateHost('::1')).toBe(true);
  });

  test('detects IPv4-compatible IPv6 loopback via isPrivateHost', () => {
    // ::7f00:1 == ::127.0.0.1
    expect(isPrivateHost('::7f00:1')).toBe(true);
    // dotted form (WHATWG URL normalizes this to ::7f00:1)
    expect(isPrivateHost('::127.0.0.1')).toBe(true);
  });

  test('detects IPv4-compatible IPv6 loopback via validateHttpUrl', () => {
    expect(validateHttpUrl('http://[::7f00:1]/').safe).toBe(false);
    // dotted form normalizes to [::7f00:1] under the WHATWG URL parser
    expect(validateHttpUrl('http://[::127.0.0.1]/').safe).toBe(false);
  });

  test('detects IPv4-compatible IPv6 link-local (cloud metadata) via isPrivateHost', () => {
    // ::a9fe:a9fe == ::169.254.169.254
    expect(isPrivateHost('::a9fe:a9fe')).toBe(true);
    expect(isPrivateHost('::169.254.169.254')).toBe(true);
  });

  test('detects IPv4-compatible IPv6 private (10.x) via isPrivateHost', () => {
    // ::a00:1 == ::10.0.0.1
    expect(isPrivateHost('::a00:1')).toBe(true);
    expect(isPrivateHost('::10.0.0.1')).toBe(true);
  });

  test('detects IPv4-compatible IPv6 loopback via assertSafePublicUrl (IP literal, no DNS)', async () => {
    expect((await assertSafePublicUrl('http://[::7f00:1]/')).safe).toBe(false);
  });

  test('allows IPv4-compatible IPv6 public address (8.8.8.8) — must not over-block', () => {
    // ::808:808 == ::8.8.8.8
    expect(isPrivateHost('::808:808')).toBe(false);
    expect(isPrivateHost('::8.8.8.8')).toBe(false);
    expect(validateHttpUrl('http://[::808:808]/').safe).toBe(true);
    expect(validateHttpUrl('http://[::8.8.8.8]/').safe).toBe(true);
  });

  // Deprecated IPv6 site-local addresses (fec0::/10, RFC 3879). First hextet
  // range is fec0-feff, which sits immediately above the fe80::/10 link-local
  // range (fe80-febf) and previously passed the blocklist.
  test('detects deprecated IPv6 site-local (fec0::/10) via isPrivateHost', () => {
    // fec0::1 — first hextet 0xfec0, the low edge of the site-local range
    expect(isPrivateHost('fec0::1')).toBe(true);
    // feff::1 — first hextet 0xfeff, the high edge of the site-local range
    expect(isPrivateHost('feff::1')).toBe(true);
  });

  test('detects deprecated IPv6 site-local (fec0::/10) via validateHttpUrl', () => {
    expect(validateHttpUrl('http://[fec0::1]/').safe).toBe(false);
  });

  test('detects deprecated IPv6 site-local (fec0::/10) via assertSafePublicUrl (IP literal, no DNS)', async () => {
    expect((await assertSafePublicUrl('http://[fec0::1]/')).safe).toBe(false);
  });

  test('does not over-block an ordinary globally routable IPv6 address', () => {
    // 2606:4700:4700::1111 — Cloudflare public DNS, a normal global unicast
    expect(isPrivateHost('2606:4700:4700::1111')).toBe(false);
    expect(validateHttpUrl('http://[2606:4700:4700::1111]/').safe).toBe(true);
  });
});
