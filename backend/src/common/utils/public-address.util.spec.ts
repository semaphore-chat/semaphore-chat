import * as dns from 'dns';
import {
  classifyAddress,
  guardedLookup,
  isPublicUrl,
  publicOnlyLookup,
  resolvesToPublicOrPrivateNetwork,
} from './public-address.util';

type LookupResult = { address: string; family: number };

/** Makes every name resolve through `table` (unknown names fail). */
function fakeDns(table: Record<string, string[]>) {
  const resolve = (host: string): LookupResult[] | null =>
    table[host]?.map((address) => ({
      address,
      family: address.includes(':') ? 6 : 4,
    })) ?? null;

  jest.spyOn(dns.promises, 'lookup').mockImplementation(((host: string) => {
    const found = resolve(host);
    return found
      ? Promise.resolve(found)
      : Promise.reject(
          Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }),
        );
  }) as never);

  jest.spyOn(dns, 'lookup').mockImplementation(((
    host: string,
    options: { all?: boolean },
    callback: (
      error: NodeJS.ErrnoException | null,
      address: string | LookupResult[],
      family?: number,
    ) => void,
  ) => {
    const found = resolve(host);
    if (!found) {
      callback(
        Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }),
        '',
      );
    } else if (options.all) {
      callback(null, found);
    } else {
      callback(null, found[0].address, found[0].family);
    }
  }) as never);
}

const TABLE = {
  'push.example.com': ['142.250.0.1'],
  'ntfy.lan': ['192.168.1.5'],
  'ntfy.tailnet': ['100.101.102.103'],
  'ntfy.ula': ['fd12:3456::7'],
  'mixed.lan': ['127.0.0.1', '192.168.1.5'],
  'loop.lan': ['127.0.0.1'],
  'metadata.lan': ['169.254.169.254'],
  'mapped.lan': ['::ffff:192.168.1.5'],
  'linklocal6.lan': ['fe80::1'],
};

function lookupAll(
  lookup: ReturnType<typeof guardedLookup>,
  host: string,
): Promise<{ error: NodeJS.ErrnoException | null }> {
  return new Promise((resolve) => {
    lookup(host, { all: true }, (error) => resolve({ error }));
  });
}

describe('public-address util', () => {
  afterEach(() => jest.restoreAllMocks());

  describe('classifyAddress', () => {
    it.each([
      ['142.250.0.1', 'public'],
      ['2606:4700::1111', 'public'],
      ['10.1.2.3', 'private-network'],
      ['172.16.0.1', 'private-network'],
      ['172.31.255.254', 'private-network'],
      ['192.168.1.5', 'private-network'],
      ['100.64.0.1', 'private-network'],
      ['fd00::1', 'private-network'],
      ['[fc00::1]', 'private-network'],
      ['127.0.0.1', 'forbidden'],
      ['::1', 'forbidden'],
      ['169.254.169.254', 'forbidden'],
      ['fe80::1%eth0', 'forbidden'],
      ['0.0.0.0', 'forbidden'],
      ['224.0.0.1', 'forbidden'],
      ['240.0.0.1', 'forbidden'],
      ['198.18.0.1', 'forbidden'],
      // Metadata and credential endpoints, even for an allowlisted host
      ['100.100.100.200', 'forbidden'],
      ['100.100.100.100', 'forbidden'],
      ['fd00:ec2::254', 'forbidden'],
      ['fd20:ce::254', 'forbidden'],
      ['FD00:EC2::254', 'forbidden'],
      // An embedded private IPv4 address could be anything: never allowed
      ['::ffff:192.168.1.5', 'forbidden'],
      ['64:ff9b::c0a8:105', 'forbidden'],
      ['not an address', 'forbidden'],
    ])('%s is %s', (address, expected) => {
      expect(classifyAddress(address)).toBe(expected);
    });
  });

  describe('resolvesToPublicOrPrivateNetwork', () => {
    beforeEach(() => fakeDns(TABLE));

    it.each([
      ['push.example.com', true],
      ['ntfy.lan', true],
      ['ntfy.tailnet', true],
      ['ntfy.ula', true],
      ['loop.lan', false],
      ['metadata.lan', false],
      ['linklocal6.lan', false],
      ['mixed.lan', false],
      ['unknown.lan', false],
      // A listed name is a host name; a literal never passes this way
      ['192.168.1.5', false],
    ])('%s -> %s', async (host, expected) => {
      await expect(resolvesToPublicOrPrivateNetwork(host)).resolves.toBe(
        expected,
      );
    });

    it('isPublicUrl still refuses the LAN host', async () => {
      await expect(isPublicUrl('ntfy.lan')).resolves.toBe(false);
      await expect(isPublicUrl('push.example.com')).resolves.toBe(true);
    });
  });

  describe('guardedLookup (connection time)', () => {
    beforeEach(() => fakeDns(TABLE));

    const allowLan = guardedLookup(
      (host) =>
        host === 'ntfy.lan' ||
        host === 'loop.lan' ||
        host === 'metadata.lan' ||
        host === 'mixed.lan' ||
        host === 'mapped.lan',
    );

    it('connects to a public host', async () => {
      expect((await lookupAll(allowLan, 'push.example.com')).error).toBeNull();
    });

    it('connects to an allowed host on a private network', async () => {
      expect((await lookupAll(allowLan, 'ntfy.lan')).error).toBeNull();
    });

    it('refuses a private-network host nobody allowed', async () => {
      const { error } = await lookupAll(allowLan, 'ntfy.tailnet');
      expect(error?.code).toBe('ENOTFOUND');
    });

    it('refuses loopback even for an allowed host', async () => {
      const { error } = await lookupAll(allowLan, 'loop.lan');
      expect(error?.code).toBe('ENOTFOUND');
    });

    it('refuses a single (non-all) lookup to a forbidden address', async () => {
      for (const host of ['metadata.lan', 'mixed.lan', 'mapped.lan']) {
        const error = await new Promise<NodeJS.ErrnoException | null>(
          (resolve) => {
            allowLan(host, {}, (e) => resolve(e));
          },
        );
        expect(error?.code).toBe('ENOTFOUND');
      }
    });

    it('passes a DNS failure through', async () => {
      const { error } = await lookupAll(allowLan, 'unknown.lan');
      expect(error?.message).toBe('ENOTFOUND');
    });

    it('publicOnlyLookup allows no private network at all', async () => {
      expect((await lookupAll(publicOnlyLookup, 'ntfy.lan')).error?.code).toBe(
        'ENOTFOUND',
      );
      expect(
        (await lookupAll(publicOnlyLookup, 'push.example.com')).error,
      ).toBeNull();
    });
  });
});
