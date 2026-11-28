import {
  MAX_PUSH_PRIVATE_HOSTS,
  PushPrivateHosts,
  parsePushPrivateHosts,
} from './push-private-hosts';

describe('parsePushPrivateHosts', () => {
  it('is empty, with no errors, when unset or blank', () => {
    for (const raw of [undefined, '', ' , ,']) {
      const { hosts, errors } = parsePushPrivateHosts(raw);
      expect(errors).toEqual([]);
      expect(hosts.entries).toEqual([]);
    }
  });

  it('reads host names and ports, trimmed and lower-cased', () => {
    const { hosts, errors } = parsePushPrivateHosts(
      ' NTFY.lan , ntfy.tailnet:8443,ntfy ,push.home.arpa:443',
    );

    expect(errors).toEqual([]);
    expect(hosts.entries).toEqual([
      { host: 'ntfy.lan', port: null },
      { host: 'ntfy.tailnet', port: 8443 },
      { host: 'ntfy', port: null },
      { host: 'push.home.arpa', port: null },
    ]);
  });

  it('drops duplicates', () => {
    const { hosts } = parsePushPrivateHosts('ntfy.lan,NTFY.LAN,ntfy.lan:8443');
    expect(hosts.entries).toEqual([
      { host: 'ntfy.lan', port: null },
      { host: 'ntfy.lan', port: 8443 },
    ]);
  });

  it.each([
    ['*.lan', 'wildcards'],
    ['192.168.1.5', 'IP addresses'],
    ['192.168.1.5:8443', 'IP addresses'],
    ['fd00::1', 'IP addresses'],
    ['[fd00::1]', 'IP addresses'],
    ['ntfy.lan:0', 'port'],
    ['ntfy.lan:70000', 'port'],
    ['ntfy.lan:http', 'not a valid host name'],
    ['ntfy.lan.', 'not a valid host name'],
    ['-ntfy.lan', 'not a valid host name'],
    ['ntfy_lan', 'not a valid host name'],
    ['https://ntfy.lan', 'not a valid host name'],
    [`${'a'.repeat(64)}.lan`, 'not a valid host name'],
  ])('refuses %s', (raw, reason) => {
    const { hosts, errors } = parsePushPrivateHosts(`ok.lan,${raw}`);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(reason);
    expect(errors[0]).toContain('PUSH_PRIVATE_HOSTS');
    expect(hosts.entries).toEqual([{ host: 'ok.lan', port: null }]);
  });

  it(`refuses more than ${MAX_PUSH_PRIVATE_HOSTS} entries`, () => {
    const raw = Array.from(
      { length: MAX_PUSH_PRIVATE_HOSTS + 1 },
      (_, i) => `h${i}.lan`,
    ).join(',');

    const { errors } = parsePushPrivateHosts(raw);

    expect(errors).toEqual([
      expect.stringContaining(`at most ${MAX_PUSH_PRIVATE_HOSTS}`),
    ]);
  });

  it(`accepts exactly ${MAX_PUSH_PRIVATE_HOSTS}`, () => {
    const raw = Array.from(
      { length: MAX_PUSH_PRIVATE_HOSTS },
      (_, i) => `h${i}.lan`,
    ).join(',');

    expect(parsePushPrivateHosts(raw).errors).toEqual([]);
  });
});

describe('PushPrivateHosts', () => {
  const hosts = parsePushPrivateHosts('ntfy.lan,ntfy.tailnet:8443').hosts;

  it('matches hosts exactly, ignoring case', () => {
    expect(hosts.allowsHost('ntfy.lan')).toBe(true);
    expect(hosts.allowsHost('NTFY.LAN')).toBe(true);
    expect(hosts.allowsHost('ntfy.tailnet')).toBe(true);
    expect(hosts.allowsHost('sub.ntfy.lan')).toBe(false);
    expect(hosts.allowsHost('lan')).toBe(false);
  });

  it('allows 443 everywhere and other ports only where listed', () => {
    expect(hosts.allowsPort('ntfy.sh', 443)).toBe(true);
    expect(hosts.allowsPort('ntfy.lan', 443)).toBe(true);
    expect(hosts.allowsPort('ntfy.lan', 8443)).toBe(false);
    expect(hosts.allowsPort('ntfy.tailnet', 8443)).toBe(true);
    expect(hosts.allowsPort('NTFY.TAILNET', 8443)).toBe(true);
    expect(hosts.allowsPort('ntfy.sh', 8443)).toBe(false);
  });

  it('allows nothing extra when empty', () => {
    const none = new PushPrivateHosts();
    expect(none.allowsHost('ntfy.lan')).toBe(false);
    expect(none.allowsPort('ntfy.lan', 8443)).toBe(false);
  });
});
