import { BlockList, isIPv4, isIPv6 } from 'net';

/**
 * Prefix length under which two IPv6 addresses count as the same client.
 * Hosts pick new temporary ("privacy", RFC 8981) addresses inside their /64
 * and may use another one for the next connection; a /64 is one network
 * (a home or office LAN), much like one public IPv4 address behind NAT.
 */
export const IPV6_CLIENT_PREFIX = 64;

/** The client a refresh token was used from, as the refresh stored it. */
export interface ClientFingerprint {
  ipAddress?: string | null;
  userAgent?: string | null;
  deviceId?: string | null;
}

/**
 * `::ffff:1.2.3.4` (IPv4 on a dual-stack socket) as `1.2.3.4`; any other
 * address trimmed and without an IPv6 zone (`%eth0`).
 */
function normalizeAddress(address: string): string {
  const trimmed = address.trim().replace(/%.*$/, '');
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(trimmed);
  return mapped ? mapped[1] : trimmed;
}

/**
 * Whether two client addresses (req.ip, which honours TRUST_PROXY) belong
 * to the same client: the same IPv4 address, or IPv6 addresses in the same
 * /64. An unknown (empty) address matches nothing.
 */
export function isSameClientAddress(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  const left = normalizeAddress(a);
  const right = normalizeAddress(b);
  if (isIPv4(left) && isIPv4(right)) return left === right;
  if (isIPv6(left) && isIPv6(right)) {
    const network = new BlockList();
    network.addSubnet(left, IPV6_CLIENT_PREFIX, 'ipv6');
    return network.check(right, 'ipv6');
  }
  // Not an IP address (or IPv4 against IPv6): only an exact match
  return left === right;
}

/**
 * Whether a request comes from the client that used a refresh token: the
 * same user agent, exactly, the same address (see isSameClientAddress) and,
 * if the token's session has a device id, the same device id.
 *
 * Tabs of one browser, and a retry after a lost response, share all three. A
 * different agent, network or install is not the client that rotated the
 * token. A session from before device ids (stored null) has only the rest.
 */
export function isSameClient(
  stored: ClientFingerprint,
  presenting: ClientFingerprint,
): boolean {
  return (
    (stored.userAgent ?? '') === (presenting.userAgent ?? '') &&
    (!stored.deviceId || stored.deviceId === presenting.deviceId) &&
    isSameClientAddress(stored.ipAddress, presenting.ipAddress)
  );
}
