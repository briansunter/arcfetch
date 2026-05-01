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

function isPrivateIpv6(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);

  const ipv4Mapped = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (ipv4Mapped) {
    return isPrivateIpv4(ipv4Mapped[1]);
  }

  if (isIP(normalized) !== 6) {
    return false;
  }

  if (normalized === '::' || normalized === '::1') {
    return true;
  }

  const firstHextetText = normalized.split(':')[0] || '0';
  const firstHextet = Number.parseInt(firstHextetText, 16);

  if (!Number.isFinite(firstHextet)) {
    return false;
  }

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
