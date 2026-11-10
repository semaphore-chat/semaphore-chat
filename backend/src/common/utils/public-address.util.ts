import { lookup as dnsLookup, promises as dns } from 'dns';
import { BlockList, isIP, type LookupFunction } from 'net';

/**
 * Address ranges an outbound request made on a user's behalf (link previews,
 * push endpoints) must never reach: everything that isn't the public internet.
 *
 * IPv4: IANA special-purpose registry. IPv6: the same, plus every form that
 * embeds an IPv4 address (mapped, compatible, translated, NAT64, 6to4,
 * Teredo), since the embedded address could be anything.
 */
const NON_PUBLIC_IPV4: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // CGNAT (Tailscale, some CNIs)
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, broadcast
];

const NON_PUBLIC_IPV6: ReadonlyArray<readonly [string, number]> = [
  ['::', 96], // unspecified, loopback, IPv4-compatible
  ['::ffff:0:0', 96], // IPv4-mapped
  ['::ffff:0:0:0', 96], // IPv4-translated
  ['64:ff9b::', 96], // NAT64
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64], // discard
  ['2001::', 23], // IETF special-purpose, including Teredo
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4
  ['3fff::', 20], // documentation
  ['5f00::', 16], // segment routing
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (deprecated, still routable internally)
  ['ff00::', 8], // multicast
];

/**
 * One list per family: a BlockList applies its IPv4-mapped rules to plain IPv4
 * addresses too, so ::ffff:0:0/96 in a shared list would block all of IPv4.
 */
const nonPublicIpv4 = new BlockList();
for (const [network, prefix] of NON_PUBLIC_IPV4) {
  nonPublicIpv4.addSubnet(network, prefix, 'ipv4');
}
const nonPublicIpv6 = new BlockList();
for (const [network, prefix] of NON_PUBLIC_IPV6) {
  nonPublicIpv6.addSubnet(network, prefix, 'ipv6');
}

/** An address as `isIP` reads it: no URL brackets, no IPv6 zone. */
function normalizeAddress(address: string): string {
  return address
    .trim()
    .replace(/^\[|\]$/g, '')
    .replace(/%.*$/, '');
}

/**
 * Whether an IP address is outside the public internet. Anything that isn't a
 * valid address counts as non-public: this is a guard, so it fails closed.
 */
export function isPrivateIp(address: string): boolean {
  const normalized = normalizeAddress(address);
  const family = isIP(normalized);
  if (family === 0) return true;
  return family === 4
    ? nonPublicIpv4.check(normalized, 'ipv4')
    : nonPublicIpv6.check(normalized, 'ipv6');
}

/**
 * Whether a URL hostname (a name, or an IP literal, bracketed or not) only
 * reaches public addresses. Blocks if ANY resolved address is non-public, and
 * if the name doesn't resolve.
 *
 * Between this check and a later connection DNS could answer differently. Use
 * `publicOnlyLookup` where the HTTP client takes a lookup function.
 */
export async function isPublicUrl(hostname: string): Promise<boolean> {
  const literal = normalizeAddress(hostname);
  if (isIP(literal) !== 0) return !isPrivateIp(literal);

  try {
    const results = await dns.lookup(hostname, { all: true });
    return results.length > 0 && !results.some((r) => isPrivateIp(r.address));
  } catch {
    return false;
  }
}

/**
 * A `lookup` for HTTP agents that refuses non-public addresses at connection
 * time, so a name can't pass a check and then resolve somewhere internal.
 */
export const publicOnlyLookup: LookupFunction = (
  hostname,
  options,
  callback,
) => {
  dnsLookup(hostname, options, (error, address, family) => {
    if (error) {
      callback(error, address, family);
      return;
    }
    const addresses: string[] = Array.isArray(address)
      ? address.map((entry: { address: string }) => entry.address)
      : [address];
    if (addresses.some((candidate) => isPrivateIp(candidate))) {
      const refused: NodeJS.ErrnoException = new Error(
        `Refusing to connect to a non-public address for ${hostname}`,
      );
      refused.code = 'ENOTFOUND';
      callback(refused, address, family);
      return;
    }
    callback(null, address, family);
  });
};
