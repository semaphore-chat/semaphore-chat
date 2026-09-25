import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { PushNotificationsController } from './push-notifications.controller';
import { PushNotificationsService } from './push-notifications.service';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { InstanceRole } from '@prisma/client';

describe('PushNotificationsController', () => {
  let controller: PushNotificationsController;
  let service: Mocked<PushNotificationsService>;

  const makeReq = (overrides: Record<string, unknown> = {}) =>
    ({
      user: {
        id: 'user-1',
        role: InstanceRole.USER,
        ...overrides,
      },
    }) as any;

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(
      PushNotificationsController,
    ).compile();

    controller = unit;
    service = unitRef.get(PushNotificationsService);

    service.isEnabled = jest.fn().mockReturnValue(true);
    service.getVapidPublicKey = jest.fn().mockReturnValue('vapid-key-123');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // =========================================================================
  // getVapidPublicKey
  // =========================================================================

  describe('getVapidPublicKey', () => {
    it('returns the VAPID public key and enabled status', () => {
      const result = controller.getVapidPublicKey();

      expect(result).toEqual({
        publicKey: 'vapid-key-123',
        enabled: true,
      });
    });

    it('returns null key and enabled=false when push is not configured', () => {
      service.getVapidPublicKey = jest.fn().mockReturnValue(null);
      service.isEnabled = jest.fn().mockReturnValue(false);

      const result = controller.getVapidPublicKey();

      expect(result).toEqual({
        publicKey: null,
        enabled: false,
      });
    });
  });

  // =========================================================================
  // subscribe
  // =========================================================================

  describe('subscribe', () => {
    it('subscribes the user and returns success', async () => {
      service.subscribe = jest.fn().mockResolvedValue(undefined);

      const dto = {
        endpoint: 'https://push.example.com',
        keys: { p256dh: 'key', auth: 'auth' },
      };
      const result = await controller.subscribe(makeReq(), dto);

      expect(service.subscribe).toHaveBeenCalledWith('user-1', dto);
      expect(result.success).toBe(true);
    });

    it('throws NotFoundException when push notifications are not enabled', async () => {
      service.isEnabled = jest.fn().mockReturnValue(false);

      await expect(controller.subscribe(makeReq(), {} as any)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // =========================================================================
  // unsubscribe
  // =========================================================================

  describe('unsubscribe', () => {
    it('unsubscribes the user and returns success', async () => {
      service.unsubscribe = jest.fn().mockResolvedValue(undefined);

      const result = await controller.unsubscribe(makeReq(), {
        endpoint: 'https://push.example.com',
      });

      expect(service.unsubscribe).toHaveBeenCalledWith(
        'user-1',
        'https://push.example.com',
      );
      expect(result.success).toBe(true);
    });
  });

  // =========================================================================
  // getStatus
  // =========================================================================

  describe('getStatus', () => {
    it('returns enabled status and subscription count', async () => {
      service.getUserSubscriptions = jest
        .fn()
        .mockResolvedValue([{ endpoint: 'a' }, { endpoint: 'b' }]);

      const result = await controller.getStatus(makeReq());

      expect(result).toEqual({
        enabled: true,
        subscriptionCount: 2,
      });
    });

    it('returns 0 subscriptions when user has none', async () => {
      service.getUserSubscriptions = jest.fn().mockResolvedValue([]);

      const result = await controller.getStatus(makeReq());

      expect(result.subscriptionCount).toBe(0);
    });
  });

  // =========================================================================
  // sendTestPushToSelf
  // =========================================================================

  describe('sendTestPushToSelf', () => {
    it('sends a test notification to the authenticated user', async () => {
      service.sendToUser = jest.fn().mockResolvedValue({ sent: 1, failed: 0 });

      const result = await controller.sendTestPushToSelf(makeReq());

      expect(service.sendToUser).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ title: 'Test Push Notification' }),
      );
      expect(result.success).toBe(true);
      expect(result.sent).toBe(1);
    });

    it('throws NotFoundException when push is not enabled', async () => {
      service.isEnabled = jest.fn().mockReturnValue(false);

      await expect(controller.sendTestPushToSelf(makeReq())).rejects.toThrow(
        NotFoundException,
      );
    });

    it('reports failure when no subscriptions exist', async () => {
      service.sendToUser = jest.fn().mockResolvedValue({ sent: 0, failed: 0 });

      const result = await controller.sendTestPushToSelf(makeReq());

      expect(result.success).toBe(false);
      expect(result.sent).toBe(0);
    });
  });

  // =========================================================================
  // sendTestPush (debug, admin-only)
  // =========================================================================

  describe('sendTestPush (debug)', () => {
    it('throws ForbiddenException for regular USER role', async () => {
      await expect(
        controller.sendTestPush(makeReq({ role: InstanceRole.USER })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows OWNER users to send debug test push', async () => {
      service.sendToUser = jest.fn().mockResolvedValue({ sent: 1, failed: 0 });

      const result = await controller.sendTestPush(
        makeReq({ role: InstanceRole.OWNER }),
      );

      expect(result.success).toBe(true);
    });

    it('throws NotFoundException when push is not enabled (even for OWNER)', async () => {
      service.isEnabled = jest.fn().mockReturnValue(false);

      await expect(
        controller.sendTestPush(makeReq({ role: InstanceRole.OWNER })),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
