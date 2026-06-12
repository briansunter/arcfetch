import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface UrlSafetyResult {
  safe: boolean;
  url?: URL;
  error?: string;
}

function normalizeHostname(hostname: string): string {
  return hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
}

function parseIpv4(hostname: string): number[] | null {
  if (isIP(hostname) !== 4) {
    return null;
  }
  const octets = hostname.split('.').map(Number);
  return octets.length === 4 && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    ? octets
    : null;
}

function isPrivateIpv4(hostname: string): boolean {
  const octets = parseIpv4(hostname);
  if (!octets) {
    return false;
  }

  const [a, b, c] = octets;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

/**
 * Normalise the trailing dotted-decimal IPv4 suffix that Node's `isIP` accepts
 * in IPv6 addresses (e.g. `::ffff:127.0.0.1`).  The WHATWG URL parser always
 * emits two hex groups for this part, but callers such as `isPrivateHost` may
 * receive the dotted form directly.  Convert it before expansion so that
 * `expandIpv6` only ever sees colon-hex groups.
 */
function normalizeDottedIpv6Suffix(addr: string): string {
  // Match an IPv4 dotted-decimal tail after the last colon.
  const m = addr.match(/^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (!m) return addr;
  const octets = m[2].split('.').map(Number);
  const hi = ((octets[0] << 8) | octets[1]).toString(16);
  const lo = ((octets[2] << 8) | octets[3]).toString(16);
  return `${m[1]}${hi}:${lo}`;
}

/**
 * Expand a validated IPv6 address string into exactly 8 hextets (as numbers).
 * Handles `::` compression and dotted-decimal suffixes. Assumes isIP(addr) === 6.
 */
function expandIpv6(addr: string): number[] {
  const normalised = normalizeDottedIpv6Suffix(addr);
  // Split on '::' to find the compressed gap.
  const halves = normalised.split('::');
  const parseHalf = (s: string): number[] => (s === '' ? [] : s.split(':').map((h) => Number.parseInt(h, 16)));

  let hextets: number[];
  if (halves.length === 2) {
    const left = parseHalf(halves[0]);
    const right = parseHalf(halves[1]);
    const gapSize = 8 - left.length - right.length;
    hextets = [...left, ...Array(gapSize).fill(0), ...right];
  } else {
    hextets = parseHalf(halves[0]);
  }

  return hextets;
}

/**
 * Given the last two hextets of an IPv4-mapped/NAT64 address, reconstruct
 * the dotted-decimal IPv4 string and delegate to isPrivateIpv4.
 */
function mappedHextetsArePrivate(hi: number, lo: number): boolean {
  const a = (hi >> 8) & 0xff;
  const b = hi & 0xff;
  const c = (lo >> 8) & 0xff;
  const d = lo & 0xff;
  return isPrivateIpv4(`${a}.${b}.${c}.${d}`);
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);

  if (isIP(normalized) !== 6) {
    return false;
  }

  if (normalized === '::' || normalized === '::1') {
    return true;
  }

  const hextets = expandIpv6(normalized);

  // ::ffff:0:0/96  — IPv4-mapped addresses (hextets 0-5 are 0,0,0,0,0,0xffff)
  if (
    hextets[0] === 0 &&
    hextets[1] === 0 &&
    hextets[2] === 0 &&
    hextets[3] === 0 &&
    hextets[4] === 0 &&
    hextets[5] === 0xffff
  ) {
    return mappedHextetsArePrivate(hextets[6], hextets[7]);
  }

  // 64:ff9b::/96  — NAT64 well-known prefix (RFC 6052)
  if (
    hextets[0] === 0x0064 &&
    hextets[1] === 0xff9b &&
    hextets[2] === 0 &&
    hextets[3] === 0 &&
    hextets[4] === 0 &&
    hextets[5] === 0
  ) {
    return mappedHextetsArePrivate(hextets[6], hextets[7]);
  }

  const firstHextet = hextets[0] ?? 0;

  return (
    (firstHextet >= 0xfc00 && firstHextet <= 0xfdff) ||
    (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) ||
    (firstHextet >= 0xff00 && firstHextet <= 0xffff) ||
    (firstHextet === 0x2001 && normalized.startsWith('2001:db8:'))
  );
}

export function isPrivateHost(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);

  if (normalized === 'localhost' || normalized.endsWith('.localhost')) {
    return true;
  }

  return isPrivateIpv4(normalized) || isPrivateIpv6(normalized);
}

export function validateHttpUrl(rawUrl: string): UrlSafetyResult {
  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch {
    return {
      safe: false,
      error: `Invalid URL: ${rawUrl}`,
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      safe: false,
      error: `Invalid URL protocol: ${parsed.protocol} - only http and https are supported`,
    };
  }

  if (isPrivateHost(parsed.hostname)) {
    return {
      safe: false,
      error: 'URL points to a private/internal network address',
    };
  }

  return { safe: true, url: parsed };
}

export async function assertSafePublicUrl(rawUrl: string): Promise<UrlSafetyResult> {
  const validation = validateHttpUrl(rawUrl);
  if (!validation.safe || !validation.url) {
    return validation;
  }

  const hostname = normalizeHostname(validation.url.hostname);

  try {
    const addresses = await lookup(hostname, { all: true });
    for (const { address } of addresses) {
      if (isPrivateHost(address)) {
        return {
          safe: false,
          error: 'URL points to a private/internal network address',
        };
      }
    }
  } catch {
    // DNS resolution failures are reported by the eventual fetch/browser navigation.
  }

  return validation;
}
