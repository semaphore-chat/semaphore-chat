import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { PushNotificationsService } from './push-notifications.service';
import { DatabaseService } from '@/database/database.service';
import { createMockDatabase } from '@/test-utils';
import * as webpush from 'web-push';

// Mock web-push module
jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
  generateVAPIDKeys: jest.fn(),
}));

// Endpoint hosts resolve as public here; the rules are tested in
// public-address and e2e (test/security-users.e2e-spec.ts)
jest.mock('@/common/utils/public-address.util', () => ({
  ...jest.requireActual('@/common/utils/public-address.util'),
  isPublicUrl: () => Promise.resolve(true),
}));

describe('PushNotificationsService', () => {
  let service: PushNotificationsService;
  let mockDatabase: ReturnType<typeof createMockDatabase>;
  let configService: Mocked<ConfigService>;

  const mockVapidPublicKey = 'BNxFj3IxG...testPublicKey';
  const mockVapidPrivateKey = 'testPrivateKey123';

  beforeEach(async () => {
    mockDatabase = createMockDatabase();

    const { unit, unitRef } = await TestBed.solitary(PushNotificationsService)
      .mock(DatabaseService)
      .final(mockDatabase)
      .compile();

    service = unit;
    configService = unitRef.get(ConfigService);

    // Default: no env vars set (so DB/auto-gen paths are tested by default)
    configService.get.mockReturnValue(undefined);

    // Default: no settings in DB
    mockDatabase.instanceSettings.findFirst.mockResolvedValue(null);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('onModuleInit', () => {
    it('should use env vars when both VAPID keys are present (tier 1)', async () => {
      configService.get.mockImplementation((key: string) => {
        switch (key) {
          case 'VAPID_PUBLIC_KEY':
            return mockVapidPublicKey;
          case 'VAPID_PRIVATE_KEY':
            return mockVapidPrivateKey;
          case 'VAPID_SUBJECT':
            return 'mailto:test@example.com';
          default:
            return undefined;
        }
      });

      await service.onModuleInit();

      expect(webpush.setVapidDetails).toHaveBeenCalledWith(
        'mailto:test@example.com',
        mockVapidPublicKey,
        mockVapidPrivateKey,
      );
      expect(service.isEnabled()).toBe(true);
      expect(mockDatabase.instanceSettings.findFirst).not.toHaveBeenCalled();
    });

    it('should use default subject when env var not set (tier 1)', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'VAPID_PUBLIC_KEY') return mockVapidPublicKey;
        if (key === 'VAPID_PRIVATE_KEY') return mockVapidPrivateKey;
        return undefined;
      });

      await service.onModuleInit();

      expect(webpush.setVapidDetails).toHaveBeenCalledWith(
        'mailto:admin@localhost',
        mockVapidPublicKey,
        mockVapidPrivateKey,
      );
    });

    it('should load keys from database when env vars are absent (tier 2)', async () => {
      const dbPublicKey = 'db-public-key';
      const dbPrivateKey = 'db-private-key';

      mockDatabase.instanceSettings.findFirst.mockResolvedValue({
        id: 'settings-1',
        vapidPublicKey: dbPublicKey,
        vapidPrivateKey: dbPrivateKey,
        vapidSubject: 'mailto:db@example.com',
      });

      await service.onModuleInit();

      expect(webpush.setVapidDetails).toHaveBeenCalledWith(
        'mailto:db@example.com',
        dbPublicKey,
        dbPrivateKey,
      );
      expect(service.isEnabled()).toBe(true);
      expect(webpush.generateVAPIDKeys).not.toHaveBeenCalled();
    });

    it('should prefer env VAPID_SUBJECT over DB subject (tier 2)', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'VAPID_SUBJECT') return 'mailto:env@example.com';
        return undefined;
      });

      mockDatabase.instanceSettings.findFirst.mockResolvedValue({
        id: 'settings-1',
        vapidPublicKey: 'db-public',
        vapidPrivateKey: 'db-private',
        vapidSubject: 'mailto:db@example.com',
      });

      await service.onModuleInit();

      expect(webpush.setVapidDetails).toHaveBeenCalledWith(
        'mailto:env@example.com',
        'db-public',
        'db-private',
      );
    });

    it('should auto-generate keys when neither env vars nor DB keys exist (tier 3)', async () => {
      const generatedKeys = {
        publicKey: 'generated-public-key',
        privateKey: 'generated-private-key',
      };
      (webpush.generateVAPIDKeys as jest.Mock).mockReturnValue(generatedKeys);
      mockDatabase.instanceSettings.create.mockResolvedValue({
        id: 'settings-1',
      });

      await service.onModuleInit();

      expect(webpush.generateVAPIDKeys).toHaveBeenCalled();
      expect(webpush.setVapidDetails).toHaveBeenCalledWith(
        'mailto:admin@localhost',
        generatedKeys.publicKey,
        generatedKeys.privateKey,
      );
      expect(service.isEnabled()).toBe(true);
    });

    it('should persist auto-generated keys to new settings record', async () => {
      const generatedKeys = {
        publicKey: 'generated-public-key',
        privateKey: 'generated-private-key',
      };
      (webpush.generateVAPIDKeys as jest.Mock).mockReturnValue(generatedKeys);
      mockDatabase.instanceSettings.create.mockResolvedValue({
        id: 'settings-1',
      });

      await service.onModuleInit();

      expect(mockDatabase.instanceSettings.create).toHaveBeenCalledWith({
        data: {
          vapidPublicKey: generatedKeys.publicKey,
          vapidPrivateKey: generatedKeys.privateKey,
          vapidSubject: 'mailto:admin@localhost',
        },
      });
    });

    it('should conditionally update existing settings when auto-generating keys', async () => {
      mockDatabase.instanceSettings.findFirst.mockResolvedValue({
        id: 'settings-1',
        vapidPublicKey: null,
        vapidPrivateKey: null,
        vapidSubject: null,
      });

      const generatedKeys = {
        publicKey: 'generated-public-key',
        privateKey: 'generated-private-key',
      };
      (webpush.generateVAPIDKeys as jest.Mock).mockReturnValue(generatedKeys);
      mockDatabase.instanceSettings.updateMany.mockResolvedValue({
        count: 1,
      });

      await service.onModuleInit();

      expect(mockDatabase.instanceSettings.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'settings-1',
          OR: [{ vapidPublicKey: null }, { vapidPublicKey: '' }],
        },
        data: {
          vapidPublicKey: generatedKeys.publicKey,
          vapidPrivateKey: generatedKeys.privateKey,
          vapidSubject: 'mailto:admin@localhost',
        },
      });
    });

    it('should auto-generate keys when DB has empty string VAPID fields (tier 3)', async () => {
      mockDatabase.instanceSettings.findFirst.mockResolvedValue({
        id: 'settings-1',
        vapidPublicKey: '',
        vapidPrivateKey: '',
        vapidSubject: '',
      });

      const generatedKeys = {
        publicKey: 'generated-public-key',
        privateKey: 'generated-private-key',
      };
      (webpush.generateVAPIDKeys as jest.Mock).mockReturnValue(generatedKeys);
      mockDatabase.instanceSettings.updateMany.mockResolvedValue({ count: 1 });

      await service.onModuleInit();

      expect(webpush.generateVAPIDKeys).toHaveBeenCalled();
      expect(mockDatabase.instanceSettings.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'settings-1',
          OR: [{ vapidPublicKey: null }, { vapidPublicKey: '' }],
        },
        data: {
          vapidPublicKey: generatedKeys.publicKey,
          vapidPrivateKey: generatedKeys.privateKey,
          vapidSubject: 'mailto:admin@localhost',
        },
      });
      expect(service.isEnabled()).toBe(true);
    });

    it('should use existing keys when another instance wins the race', async () => {
      mockDatabase.instanceSettings.findFirst
        .mockResolvedValueOnce({
          id: 'settings-1',
          vapidPublicKey: null,
          vapidPrivateKey: null,
          vapidSubject: null,
        })
        // Second call (reload after race loss) returns the winner's keys
        .mockResolvedValueOnce({
          id: 'settings-1',
          vapidPublicKey: 'winner-public-key',
          vapidPrivateKey: 'winner-private-key',
          vapidSubject: 'mailto:winner@example.com',
        });

      const generatedKeys = {
        publicKey: 'loser-public-key',
        privateKey: 'loser-private-key',
      };
      (webpush.generateVAPIDKeys as jest.Mock).mockReturnValue(generatedKeys);
      // updateMany returns 0 — another instance already wrote keys
      mockDatabase.instanceSettings.updateMany.mockResolvedValue({ count: 0 });

      await service.onModuleInit();

      expect(webpush.setVapidDetails).toHaveBeenCalledWith(
        'mailto:winner@example.com',
        'winner-public-key',
        'winner-private-key',
      );
      expect(service.getVapidPublicKey()).toBe('winner-public-key');
    });

    it('should handle database errors gracefully', async () => {
      mockDatabase.instanceSettings.findFirst.mockRejectedValue(
        new Error('DB connection failed'),
      );

      await service.onModuleInit();

      expect(service.isEnabled()).toBe(false);
    });
  });

  describe('getVapidPublicKey', () => {
    it('should return cached public key when configured via env vars', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'VAPID_PUBLIC_KEY') return mockVapidPublicKey;
        if (key === 'VAPID_PRIVATE_KEY') return mockVapidPrivateKey;
        return undefined;
      });

      await service.onModuleInit();

      expect(service.getVapidPublicKey()).toBe(mockVapidPublicKey);
    });

    it('should return cached public key when loaded from DB', async () => {
      mockDatabase.instanceSettings.findFirst.mockResolvedValue({
        id: 'settings-1',
        vapidPublicKey: 'db-public-key',
        vapidPrivateKey: 'db-private-key',
        vapidSubject: null,
      });

      await service.onModuleInit();

      expect(service.getVapidPublicKey()).toBe('db-public-key');
    });

    it('should return null when not configured', async () => {
      mockDatabase.instanceSettings.findFirst.mockRejectedValue(
        new Error('DB error'),
      );

      await service.onModuleInit();

      expect(service.getVapidPublicKey()).toBeNull();
    });
  });

  describe('subscribe', () => {
    const userId = 'user-123';
    const subscribeDto = {
      endpoint: 'https://push.example.com/abc123',
      keys: {
        p256dh: 'testP256dhKey',
        auth: 'testAuthKey',
      },
      userAgent: 'Mozilla/5.0 Test',
    };

    it('should upsert subscription in database', async () => {
      const mockSubscription = {
        id: 'sub-1',
        userId,
        endpoint: subscribeDto.endpoint,
        keys: subscribeDto.keys,
        userAgent: subscribeDto.userAgent,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDatabase.pushSubscription.upsert.mockResolvedValue(mockSubscription);

      const result = await service.subscribe(userId, subscribeDto);

      expect(result).toEqual(mockSubscription);
      expect(mockDatabase.pushSubscription.upsert).toHaveBeenCalledWith({
        where: { endpoint: subscribeDto.endpoint },
        update: {
          userId,
          keys: subscribeDto.keys,
          userAgent: subscribeDto.userAgent,
          updatedAt: expect.any(Date),
        },
        create: {
          userId,
          endpoint: subscribeDto.endpoint,
          keys: subscribeDto.keys,
          userAgent: subscribeDto.userAgent,
        },
      });
    });

    it('should refuse a new subscription once the user has 10 others', async () => {
      mockDatabase.pushSubscription.count.mockResolvedValue(10);

      await expect(service.subscribe(userId, subscribeDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockDatabase.pushSubscription.count).toHaveBeenCalledWith({
        where: { userId, NOT: { endpoint: subscribeDto.endpoint } },
      });
      expect(mockDatabase.pushSubscription.upsert).not.toHaveBeenCalled();
    });

    it('should still allow re-subscribing an existing endpoint at the limit', async () => {
      const mockSubscription = {
        id: 'sub-1',
        userId,
        endpoint: subscribeDto.endpoint,
        keys: subscribeDto.keys,
        userAgent: subscribeDto.userAgent,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockDatabase.pushSubscription.count.mockResolvedValue(9);
      mockDatabase.pushSubscription.upsert.mockResolvedValue(mockSubscription);

      await expect(service.subscribe(userId, subscribeDto)).resolves.toEqual(
        mockSubscription,
      );
    });
  });

  describe('unsubscribe', () => {
    it('should delete subscription from database', async () => {
      const userId = 'user-123';
      const endpoint = 'https://push.example.com/abc123';

      mockDatabase.pushSubscription.deleteMany.mockResolvedValue({ count: 1 });

      await service.unsubscribe(userId, endpoint);

      expect(mockDatabase.pushSubscription.deleteMany).toHaveBeenCalledWith({
        where: { userId, endpoint },
      });
    });
  });

  describe('getUserSubscriptions', () => {
    it('should return all subscriptions for user', async () => {
      const userId = 'user-123';
      const mockSubscriptions = [
        { id: 'sub-1', userId, endpoint: 'https://push1.example.com' },
        { id: 'sub-2', userId, endpoint: 'https://push2.example.com' },
      ];

      mockDatabase.pushSubscription.findMany.mockResolvedValue(
        mockSubscriptions,
      );

      const result = await service.getUserSubscriptions(userId);

      expect(result).toEqual(mockSubscriptions);
      expect(mockDatabase.pushSubscription.findMany).toHaveBeenCalledWith({
        where: { userId },
      });
    });
  });

  describe('sendToUser', () => {
    const userId = 'user-123';
    const payload = {
      title: 'Test Notification',
      body: 'Test body',
      tag: 'test-tag',
    };

    beforeEach(async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'VAPID_PUBLIC_KEY') return mockVapidPublicKey;
        if (key === 'VAPID_PRIVATE_KEY') return mockVapidPrivateKey;
        return undefined;
      });
      await service.onModuleInit();
    });

    it('should return early when not configured', async () => {
      const unconfiguredService = new PushNotificationsService(
        configService as unknown as ConfigService,
        mockDatabase as unknown as DatabaseService,
      );
      // Don't call onModuleInit — service stays unconfigured

      const result = await unconfiguredService.sendToUser(userId, payload);

      expect(result).toEqual({ sent: 0, failed: 0 });
      expect(mockDatabase.pushSubscription.findMany).not.toHaveBeenCalled();
    });

    it('should return zeros when user has no subscriptions', async () => {
      mockDatabase.pushSubscription.findMany.mockResolvedValue([]);

      const result = await service.sendToUser(userId, payload);

      expect(result).toEqual({ sent: 0, failed: 0 });
    });

    it('should send to all user subscriptions', async () => {
      const mockSubscriptions = [
        {
          id: 'sub-1',
          userId,
          endpoint: 'https://push1.example.com',
          keys: { p256dh: 'key1', auth: 'auth1' },
        },
        {
          id: 'sub-2',
          userId,
          endpoint: 'https://push2.example.com',
          keys: { p256dh: 'key2', auth: 'auth2' },
        },
      ];

      mockDatabase.pushSubscription.findMany.mockResolvedValue(
        mockSubscriptions,
      );
      (webpush.sendNotification as jest.Mock).mockResolvedValue({});

      const result = await service.sendToUser(userId, payload);

      expect(result).toEqual({ sent: 2, failed: 0 });
      expect(webpush.sendNotification).toHaveBeenCalledTimes(2);
    });

    it('should send in chunks of at most five at a time', async () => {
      const subscriptions = Array.from({ length: 12 }, (_, i) => ({
        id: `sub-${i}`,
        userId,
        endpoint: `https://push${i}.example.com`,
        keys: { p256dh: `key${i}`, auth: `auth${i}` },
      }));
      mockDatabase.pushSubscription.findMany.mockResolvedValue(subscriptions);

      let inFlight = 0;
      let maxInFlight = 0;
      (webpush.sendNotification as jest.Mock).mockImplementation(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        // An async mock runs to its first await synchronously, so calls the
        // service makes without waiting pile up here: maxInFlight is the
        // fan-out width.
        await Promise.resolve();
        inFlight--;
        return {};
      });

      const result = await service.sendToUser(userId, payload);

      expect(result).toEqual({ sent: 12, failed: 0 });
      expect(maxInFlight).toBe(5);
    });

    it('should remove expired subscriptions (410 status)', async () => {
      const mockSubscription = {
        id: 'sub-1',
        userId,
        endpoint: 'https://push.example.com',
        keys: { p256dh: 'key1', auth: 'auth1' },
      };

      mockDatabase.pushSubscription.findMany.mockResolvedValue([
        mockSubscription,
      ]);
      (webpush.sendNotification as jest.Mock).mockRejectedValue({
        statusCode: 410,
      });
      mockDatabase.pushSubscription.delete.mockResolvedValue(mockSubscription);

      const result = await service.sendToUser(userId, payload);

      expect(result).toEqual({ sent: 0, failed: 1 });
      expect(mockDatabase.pushSubscription.delete).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
      });
    });

    it('should remove not found subscriptions (404 status)', async () => {
      const mockSubscription = {
        id: 'sub-1',
        userId,
        endpoint: 'https://push.example.com',
        keys: { p256dh: 'key1', auth: 'auth1' },
      };

      mockDatabase.pushSubscription.findMany.mockResolvedValue([
        mockSubscription,
      ]);
      (webpush.sendNotification as jest.Mock).mockRejectedValue({
        statusCode: 404,
      });
      mockDatabase.pushSubscription.delete.mockResolvedValue(mockSubscription);

      const result = await service.sendToUser(userId, payload);

      expect(result).toEqual({ sent: 0, failed: 1 });
      expect(mockDatabase.pushSubscription.delete).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
      });
    });
  });

  describe('action tokens', () => {
    const jwtSecret = 'test-jwt-secret';
    const userId = 'user-123';
    const notificationId = 'notification-456';

    beforeEach(() => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'JWT_SECRET') return jwtSecret;
        return undefined;
      });
    });

    describe('createActionToken', () => {
      it('should return null when JWT_SECRET is not configured', () => {
        configService.get.mockReturnValue(undefined);

        const token = service.createActionToken(userId, notificationId);

        expect(token).toBeNull();
      });

      it('should create a token with exactly two dot-separated parts', () => {
        const token = service.createActionToken(userId, notificationId);

        expect(token).not.toBeNull();
        expect(token!.split('.')).toHaveLength(2);
      });
    });

    describe('verifyActionToken', () => {
      it('should round-trip: verify returns the ids used to create the token', () => {
        const token = service.createActionToken(userId, notificationId);

        const claims = service.verifyActionToken(token!);

        expect(claims).toEqual({ userId, notificationId });
      });

      it('should return null when JWT_SECRET is not configured', () => {
        const token = service.createActionToken(userId, notificationId);

        configService.get.mockReturnValue(undefined);
        const claims = service.verifyActionToken(token!);

        expect(claims).toBeNull();
      });

      it('should reject a token with a tampered payload', () => {
        const token = service.createActionToken(userId, notificationId);
        const [, signature] = token!.split('.');

        const tamperedPayload = Buffer.from(
          JSON.stringify({
            u: 'attacker',
            n: notificationId,
            exp: Math.floor(Date.now() / 1000) + 1000,
          }),
        ).toString('base64url');

        const claims = service.verifyActionToken(
          `${tamperedPayload}.${signature}`,
        );

        expect(claims).toBeNull();
      });

      it('should reject a token with a tampered signature', () => {
        const token = service.createActionToken(userId, notificationId);
        const [payloadB64, signature] = token!.split('.');
        // Flip a character in the middle of the signature (not the last
        // char — in a 32-byte base64url digest the last char's low bits
        // are padding, so some substitutions there are no-ops).
        const mid = Math.floor(signature.length / 2);
        const tamperedChar = signature[mid] === 'A' ? 'B' : 'A';
        const tamperedSignature =
          signature.slice(0, mid) + tamperedChar + signature.slice(mid + 1);

        const claims = service.verifyActionToken(
          `${payloadB64}.${tamperedSignature}`,
        );

        expect(claims).toBeNull();
      });

      it('should reject a token with a truncated signature', () => {
        const token = service.createActionToken(userId, notificationId);
        const [payloadB64, signature] = token!.split('.');

        const claims = service.verifyActionToken(
          `${payloadB64}.${signature.slice(0, 4)}`,
        );

        expect(claims).toBeNull();
      });

      it.each(['', 'abc', 'a.b.c'])(
        'should reject malformed token %j',
        (malformed) => {
          const claims = service.verifyActionToken(malformed);

          expect(claims).toBeNull();
        },
      );

      it('should reject an expired token', () => {
        // Hand-craft a token using the same derivation as the service, but
        // with an already-expired `exp`.
        const key = createHmac('sha256', jwtSecret)
          .update('semaphore-push-action-v1')
          .digest();
        const payload = {
          u: userId,
          n: notificationId,
          exp: Math.floor(Date.now() / 1000) - 10,
        };
        const payloadB64 = Buffer.from(JSON.stringify(payload)).toString(
          'base64url',
        );
        const signature = createHmac('sha256', key)
          .update(payloadB64)
          .digest('base64url');
        const expiredToken = `${payloadB64}.${signature}`;

        const claims = service.verifyActionToken(expiredToken);

        expect(claims).toBeNull();
      });

      it('should reject a token whose payload is missing required fields', () => {
        const key = createHmac('sha256', jwtSecret)
          .update('semaphore-push-action-v1')
          .digest();
        const payload = { u: userId }; // missing n and exp
        const payloadB64 = Buffer.from(JSON.stringify(payload)).toString(
          'base64url',
        );
        const signature = createHmac('sha256', key)
          .update(payloadB64)
          .digest('base64url');

        const claims = service.verifyActionToken(`${payloadB64}.${signature}`);

        expect(claims).toBeNull();
      });

      it('should reject a token whose payload is unparseable JSON', () => {
        const key = createHmac('sha256', jwtSecret)
          .update('semaphore-push-action-v1')
          .digest();
        const payloadB64 = Buffer.from('not-json').toString('base64url');
        const signature = createHmac('sha256', key)
          .update(payloadB64)
          .digest('base64url');

        const claims = service.verifyActionToken(`${payloadB64}.${signature}`);

        expect(claims).toBeNull();
      });
    });
  });

  describe('cleanupExpiredSubscriptions', () => {
    it('should delete subscriptions older than 30 days', async () => {
      mockDatabase.pushSubscription.deleteMany.mockResolvedValue({ count: 5 });

      const result = await service.cleanupExpiredSubscriptions();

      expect(result).toBe(5);
      expect(mockDatabase.pushSubscription.deleteMany).toHaveBeenCalledWith({
        where: {
          updatedAt: {
            lt: expect.any(Date),
          },
        },
      });

      // Verify the date is approximately 30 days ago
      const callArgs =
        mockDatabase.pushSubscription.deleteMany.mock.calls[0][0];
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const calledDate = callArgs.where.updatedAt.lt as Date;

      // Should be within a few seconds of 30 days ago
      expect(
        Math.abs(calledDate.getTime() - thirtyDaysAgo.getTime()),
      ).toBeLessThan(5000);
    });
  });
});
