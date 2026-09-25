import { isSameClient, isSameClientAddress } from './client-match.util';

describe('client-match.util', () => {
  describe('isSameClientAddress', () => {
    it.each([
      ['the same IPv4 address', '203.0.113.1', '203.0.113.1'],
      [
        'IPv4 and the same address mapped to IPv6 (dual-stack socket)',
        '::ffff:203.0.113.1',
        '203.0.113.1',
      ],
      [
        'IPv6 addresses of one /64 (privacy addresses)',
        '2001:db8:5:6::10',
        '2001:db8:5:6:a:b:c:d',
      ],
      ['IPv6 in another notation', '2001:DB8:5:6::10', '2001:db8:5:6:0:0:0:99'],
      ['IPv6 with a zone', 'fe80::1%eth0', 'fe80::2'],
    ])('matches %s', (_, a, b) => {
      expect(isSameClientAddress(a, b)).toBe(true);
      expect(isSameClientAddress(b, a)).toBe(true);
    });

    it.each([
      ['another IPv4 address', '203.0.113.1', '203.0.113.2'],
      ['another IPv6 /64', '2001:db8:5:6::10', '2001:db8:5:7::10'],
      ['IPv4 against IPv6', '203.0.113.1', '2001:db8::1'],
      ['an unknown address', '', '203.0.113.1'],
      ['two unknown addresses', null, undefined],
    ])('does not match %s', (_, a, b) => {
      expect(isSameClientAddress(a, b)).toBe(false);
      expect(isSameClientAddress(b, a)).toBe(false);
    });
  });

  describe('isSameClient', () => {
    const stored = { ipAddress: '203.0.113.1', userAgent: 'Chrome/120' };

    it('matches the same address and user agent', () => {
      expect(isSameClient(stored, { ...stored })).toBe(true);
    });

    it('requires the exact user agent', () => {
      expect(isSameClient(stored, { ...stored, userAgent: 'Chrome/121' })).toBe(
        false,
      );
      expect(isSameClient(stored, { ...stored, userAgent: undefined })).toBe(
        false,
      );
    });

    it('treats a missing user agent like an empty one', () => {
      expect(
        isSameClient(
          { ipAddress: '203.0.113.1', userAgent: null },
          { ipAddress: '203.0.113.1', userAgent: '' },
        ),
      ).toBe(true);
    });

    it('requires the same address', () => {
      expect(
        isSameClient(stored, { ...stored, ipAddress: '198.51.100.7' }),
      ).toBe(false);
    });
  });
});
