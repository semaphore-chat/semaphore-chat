import * as request from 'supertest';
import { promises as dnsPromises } from 'dns';
import {
  createE2eApp,
  E2eApp,
  loginUser,
  registerUser,
  resetDatabase,
  seedInstanceInvite,
} from './helpers/e2e-app';
import { DatabaseService } from '@/database/database.service';
import {
  PUSH_PRIVATE_HOSTS,
  parsePushPrivateHosts,
} from '@/push-notifications/push-private-hosts';

/**
 * PUSH_PRIVATE_HOSTS lets an operator name push services on a private
 * network (UnifiedPush with a self-hosted ntfy on the LAN or a tailnet).
 * Only the listed hosts may resolve to private-network addresses, only on
 * the ports listed, and never to loopback or link-local addresses.
 *
 * DNS is faked (as in security-users.e2e-spec.ts), so the cases are the same
 * on the per-ticket stack and in CI, where Redis is `localhost`.
 */
describe('Push endpoints on private networks (e2e)', () => {
  let app: E2eApp;
  let db: DatabaseService;
  let token: string;
  let userId: string;

  const ADDRESSES: Record<string, string> = {
    'ntfy.sh': '159.203.148.75',
    'ntfy.lan': '192.168.1.5',
    'ntfy.tailnet': '100.101.102.103',
    'ntfy.ula': 'fd12:3456::7',
    'unlisted.lan': '192.168.1.6',
    'loop.lan': '127.0.0.1',
    'metadata.lan': '169.254.169.254',
  };

  beforeAll(async () => {
    app = await createE2eApp({
      overrides: (builder) =>
        builder
          .overrideProvider(PUSH_PRIVATE_HOSTS)
          .useValue(
            parsePushPrivateHosts(
              'ntfy.lan,ntfy.tailnet:8443,ntfy.ula,loop.lan,metadata.lan,gone.lan',
            ).hosts,
          ),
    });
    db = app.get(DatabaseService);
    await resetDatabase(app);
    await seedInstanceInvite(app);
    const registered = await registerUser(app, {
      username: 'push-private-hosts',
      password: 'Password123!',
      email: 'push-private-hosts@test.local',
    });
    userId = registered.id;
    token = (await loginUser(app, 'push-private-hosts', 'Password123!'))
      .accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.pushSubscription.deleteMany({ where: { userId } });
    jest.spyOn(dnsPromises, 'lookup').mockImplementation(((host: string) => {
      const address = ADDRESSES[host];
      return address
        ? Promise.resolve([{ address, family: address.includes(':') ? 6 : 4 }])
        : Promise.reject(new Error(`ENOTFOUND ${host}`));
    }) as never);
  });

  afterEach(() => jest.restoreAllMocks());

  const subscribe = (endpoint: string) =>
    request(app.getHttpServer())
      .post('/api/push/subscribe')
      .set('Authorization', `Bearer ${token}`)
      .send({ endpoint, keys: { p256dh: 'p256dh-key', auth: 'auth-key' } });

  it.each([
    ['a public push service', 'https://ntfy.sh/upAbc123?up=1'],
    ['a listed LAN host', 'https://ntfy.lan/upAbc123?up=1'],
    ['a listed host in any letter case', 'https://NTFY.LAN/upAbc123'],
    [
      'a listed tailnet host on its listed port',
      'https://ntfy.tailnet:8443/up',
    ],
    ['a listed IPv6 unique-local host', 'https://ntfy.ula/up'],
    // 443 is always allowed; a listed port is allowed as well
    ['a host listed with a port, on 443', 'https://ntfy.tailnet/up'],
  ])('accepts %s', async (_what, endpoint) => {
    await subscribe(endpoint).expect(201);

    expect(
      await db.pushSubscription.count({ where: { userId, endpoint } }),
    ).toBe(1);
  });

  it.each([
    ['a private host that is not listed', 'https://unlisted.lan/up'],
    ['a listed host on a port it does not list', 'https://ntfy.lan:8443/up'],
    ['a listed host resolving to loopback', 'https://loop.lan/up'],
    [
      'a listed host resolving to the metadata service',
      'https://metadata.lan/up',
    ],
    ['an IP address on the LAN', 'https://192.168.1.5/up'],
    ['plain http to a listed host', 'http://ntfy.lan/up'],
    ['a listed host that does not resolve', 'https://gone.lan/up'],
  ])('refuses %s', async (_what, endpoint) => {
    await subscribe(endpoint).expect(400);

    expect(await db.pushSubscription.count({ where: { userId } })).toBe(0);
  });

  it('lists the subscription by its host only', async () => {
    await subscribe('https://ntfy.lan/upSecretTopic?up=1').expect(201);

    const res = await request(app.getHttpServer())
      .get('/api/push/subscriptions')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual([
      expect.objectContaining({ endpointHost: 'ntfy.lan' }),
    ]);
    expect(JSON.stringify(res.body)).not.toContain('upSecretTopic');
  });
});
