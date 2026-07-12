/**
 * HTML character-encoding detection and decoding.
 *
 * The simple HTTP fetch path reads raw response bytes. Those bytes must be
 * decoded using the page's declared character set before Readability
 * extraction, otherwise a valid non-UTF-8 page is silently saved as
 * replacement-character garbage.
 *
 * Detection precedence (a pragmatic slice of the WHATWG encoding-sniffing
 * algorithm, at the granularity this tool needs):
 *
 *   1. Byte-order mark (UTF-8, UTF-16LE, UTF-16BE)
 *   2. HTTP Content-Type charset parameter
 *   3. A best-effort scan of the first 1024 bytes for a <meta charset> or
 *      <meta http-equiv="content-type"> declaration
 *   4. UTF-8 (the modern web default)
 *
 * Unknown or unsupported labels fall back to forgiving UTF-8 decoding rather
 * than throwing, so a strange label can never break a fetch.
 */

const META_SCAN_BYTES = 1024;

/**
 * Pull a `charset=...` value out of a Content-Type (or content-attribute)
 * string. Handles double-quoted, single-quoted, and unquoted labels.
 * Returns the lowercased, trimmed label, or undefined when none is present.
 */
export function parseContentTypeCharset(contentType: string | null | undefined): string | undefined {
  if (!contentType) {
    return undefined;
  }

  const match = contentType.match(/charset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;"'\s]+))/i);
  if (!match) {
    return undefined;
  }

  const label = (match[1] ?? match[2] ?? match[3] ?? '').trim().toLowerCase();
  return label.length > 0 ? label : undefined;
}

function detectBom(bytes: Uint8Array): string | undefined {
  if (bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return 'utf-8';
  }
  if (bytes.byteLength >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return 'utf-16le';
  }
  if (bytes.byteLength >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return 'utf-16be';
  }
  return undefined;
}

/**
 * Render the first up-to-1024 bytes as an ASCII-safe string for meta scanning.
 * Bytes outside ASCII become spaces; meta charset declarations live entirely in
 * the ASCII range, so they survive intact regardless of the page's real
 * encoding.
 */
function asciiHead(bytes: Uint8Array): string {
  const end = Math.min(bytes.byteLength, META_SCAN_BYTES);
  const chars: string[] = [];
  for (let i = 0; i < end; i++) {
    const byte = bytes[i];
    chars.push(byte < 0x80 ? String.fromCharCode(byte) : ' ');
  }
  return chars.join('');
}

/** Extract an attribute's value (quoted or bare) from a single tag string. */
function attrValue(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i'));
  if (!match) {
    return undefined;
  }
  const value = (match[1] ?? match[2] ?? match[3] ?? '').trim();
  return value.length > 0 ? value : undefined;
}

/** Best-effort charset declaration from <meta> tags within the head bytes. */
function charsetFromMeta(bytes: Uint8Array): string | undefined {
  const metaTags = asciiHead(bytes).match(/<meta\b[^>]*>/gi);
  if (!metaTags) {
    return undefined;
  }

  for (const tag of metaTags) {
    // Modern short form: <meta charset="shift_jis">
    const direct = attrValue(tag, 'charset');
    if (direct) {
      return direct.toLowerCase();
    }

    // Legacy: <meta http-equiv="content-type" content="...; charset=shift_jis">
    const httpEquiv = attrValue(tag, 'http-equiv');
    if (httpEquiv && httpEquiv.toLowerCase() === 'content-type') {
      const content = attrValue(tag, 'content');
      if (content) {
        const label = parseContentTypeCharset(content);
        if (label) {
          return label;
        }
      }
    }
  }

  return undefined;
}

/**
 * Detect the character-encoding label for the given bytes, following the
 * precedence BOM → HTTP Content-Type charset → <meta> declaration → UTF-8.
 * Always returns a value; UTF-8 is the fallback. The result is suitable for
 * passing to TextDecoder.
 */
export function detectCharset(bytes: Uint8Array, contentType?: string | null): string {
  const fromBom = detectBom(bytes);
  if (fromBom) {
    return fromBom;
  }

  const fromHttp = parseContentTypeCharset(contentType);
  if (fromHttp) {
    return fromHttp;
  }

  const fromMeta = charsetFromMeta(bytes);
  if (fromMeta) {
    return fromMeta;
  }

  return 'utf-8';
}

/**
 * Decode HTML bytes using the detected character set. Unsupported or unknown
 * labels fall back to forgiving UTF-8 rather than throwing.
 */
export function decodeHtmlBytes(bytes: Uint8Array, contentType?: string | null): string {
  const label = detectCharset(bytes, contentType);
  try {
    // Bun supports the full WHATWG label set at runtime (e.g. shift_jis,
    // iso-8859-1); the typed signature only declares a narrow subset, so the
    // detected label is asserted here. Unsupported labels still throw and are
    // caught below.
    return new TextDecoder(label as Bun.Encoding, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}
