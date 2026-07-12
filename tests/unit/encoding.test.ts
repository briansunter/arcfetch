import { describe, expect, test } from 'bun:test';
import { decodeHtmlBytes, detectCharset, parseContentTypeCharset } from '../../src/utils/encoding';

// Shift_JIS byte sequences verified against TextDecoder('shift_jis').
// あいうえお in Shift_JIS.
const SHIFT_JIS_AOIUEO = Uint8Array.of(0x82, 0xa0, 0x82, 0xa2, 0x82, 0xa4, 0x82, 0xa6, 0x82, 0xa8);

const UTF8_BOM = Uint8Array.of(0xef, 0xbb, 0xbf);
const UTF16LE_BOM = Uint8Array.of(0xff, 0xfe);
const UTF16BE_BOM = Uint8Array.of(0xfe, 0xff);

function ascii(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

describe('parseContentTypeCharset', () => {
  test('unquoted label', () => {
    expect(parseContentTypeCharset('text/html; charset=Shift_JIS')).toBe('shift_jis');
  });

  test('double-quoted label', () => {
    expect(parseContentTypeCharset('text/html; charset="Shift_JIS"')).toBe('shift_jis');
  });

  test('single-quoted label', () => {
    expect(parseContentTypeCharset("text/html; charset='Shift_JIS'")).toBe('shift_jis');
  });

  test('returns undefined when absent or empty', () => {
    expect(parseContentTypeCharset('text/html')).toBeUndefined();
    expect(parseContentTypeCharset('text/html; charset=')).toBeUndefined();
    expect(parseContentTypeCharset(null)).toBeUndefined();
    expect(parseContentTypeCharset(undefined)).toBeUndefined();
  });
});

describe('detectCharset precedence', () => {
  test('defaults to UTF-8 when nothing is declared', () => {
    expect(detectCharset(ascii('hello world'))).toBe('utf-8');
  });

  test('uses HTTP Content-Type charset', () => {
    expect(detectCharset(ascii('hello'), 'text/html; charset=euc-jp')).toBe('euc-jp');
  });

  test('uses quoted HTTP Content-Type charset', () => {
    expect(detectCharset(ascii('hello'), 'text/html; charset="Shift_JIS"')).toBe('shift_jis');
  });

  test('uses meta charset declaration', () => {
    const html = ascii('<html><head><meta charset="shift_jis"></head></html>');
    expect(detectCharset(html)).toBe('shift_jis');
  });

  test('uses meta http-equiv content-type declaration', () => {
    const html = ascii(
      '<html><head><meta http-equiv="Content-Type" content="text/html; charset=shift_jis"></head></html>'
    );
    expect(detectCharset(html)).toBe('shift_jis');
  });

  test('HTTP charset wins over meta when no BOM is present', () => {
    const html = ascii('<html><head><meta charset="shift_jis"></head></html>');
    expect(detectCharset(html, 'text/html; charset=euc-jp')).toBe('euc-jp');
  });

  test('UTF-8 BOM wins over HTTP charset and meta', () => {
    const html = concat(UTF8_BOM, ascii('<html><head><meta charset="shift_jis"></head></html>'));
    expect(detectCharset(html, 'text/html; charset=shift_jis')).toBe('utf-8');
  });

  test('UTF-16LE BOM is detected', () => {
    expect(detectCharset(concat(UTF16LE_BOM, ascii('x')))).toBe('utf-16le');
  });

  test('UTF-16BE BOM is detected', () => {
    expect(detectCharset(concat(UTF16BE_BOM, ascii('x')))).toBe('utf-16be');
  });
});

describe('decodeHtmlBytes', () => {
  test('decodes UTF-8 by default', () => {
    expect(decodeHtmlBytes(ascii('héllo'))).toBe('héllo');
  });

  test('decodes a non-UTF-8 (Shift_JIS) page using the HTTP charset', () => {
    const decoded = decodeHtmlBytes(SHIFT_JIS_AOIUEO, 'text/html; charset=Shift_JIS');
    expect(decoded).toBe('あいうえお');
    expect(decoded).not.toContain('�');
  });

  test('decodes a Shift_JIS page declared via meta charset', () => {
    const html = concat(
      ascii('<html><head><meta charset="shift_jis"><title>'),
      SHIFT_JIS_AOIUEO,
      ascii('</title></head></html>')
    );
    expect(decodeHtmlBytes(html)).toBe('<html><head><meta charset="shift_jis"><title>あいうえお</title></head></html>');
  });

  test('decodes an ISO-8859-1 page (single-byte, non-UTF-8)', () => {
    // 0xE9 is é in ISO-8859-1 (invalid standalone in UTF-8).
    const decoded = decodeHtmlBytes(Uint8Array.of(0xe9), 'text/html; charset=iso-8859-1');
    expect(decoded).toBe('é');
    expect(decoded).not.toContain('�');
  });

  test('falls back to UTF-8 for an unsupported charset label rather than throwing', () => {
    const html = concat(
      ascii('<html><head><meta charset="totally-fake-charset"><title>'),
      SHIFT_JIS_AOIUEO,
      ascii('</title></head></html>')
    );
    // Unsupported meta label → UTF-8 fallback. ASCII survives; the Shift_JIS
    // bytes are not valid UTF-8, but the key guarantee is that no exception is
    // thrown and the ASCII structure is preserved.
    const decoded = decodeHtmlBytes(html);
    expect(decoded.startsWith('<html><head><meta charset="totally-fake-charset"><title>')).toBe(true);
  });
});
