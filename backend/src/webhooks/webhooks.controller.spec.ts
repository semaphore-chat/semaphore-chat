import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import {
  THROTTLER_LIMIT,
  THROTTLER_TTL,
} from '@nestjs/throttler/dist/throttler.constants';
import { RbacActions } from '@prisma/client';
import {
  WebhookExecutionController,
  WebhooksController,
} from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { RBAC_ACTION_KEY } from '@/auth/rbac-action.decorator';
import {
  RBAC_RESOURCE_KEY,
  RbacResourceType,
  ResourceIdSource,
} from '@/auth/rbac-resource.decorator';
import { IS_PUBLIC_KEY } from '@/auth/public.decorator';

describe('WebhooksController', () => {
  let controller: WebhooksController;
  let webhooksService: Mocked<WebhooksService>;

  beforeEach(async () => {
    const { unit, unitRef } =
      await TestBed.solitary(WebhooksController).compile();

    controller = unit;
    webhooksService = unitRef.get(WebhooksService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  describe('RBAC metadata on management routes', () => {
    it('requires UPDATE_CHANNEL and a CHANNEL resource (from params) on create', () => {
      expect(
        Reflect.getMetadata(
          RBAC_ACTION_KEY,
          WebhooksController.prototype.create,
        ),
      ).toEqual([RbacActions.UPDATE_CHANNEL]);
      expect(
        Reflect.getMetadata(
          RBAC_RESOURCE_KEY,
          WebhooksController.prototype.create,
        ),
      ).toEqual({
        type: RbacResourceType.CHANNEL,
        idKey: 'channelId',
        source: ResourceIdSource.PARAM,
      });
    });

    it('requires UPDATE_CHANNEL and a CHANNEL resource (from params) on list', () => {
      expect(
        Reflect.getMetadata(
          RBAC_ACTION_KEY,
          WebhooksController.prototype.findAllForChannel,
        ),
      ).toEqual([RbacActions.UPDATE_CHANNEL]);
      expect(
        Reflect.getMetadata(
          RBAC_RESOURCE_KEY,
          WebhooksController.prototype.findAllForChannel,
        ),
      ).toEqual({
        type: RbacResourceType.CHANNEL,
        idKey: 'channelId',
        source: ResourceIdSource.PARAM,
      });
    });

    it('requires UPDATE_CHANNEL and a CHANNEL resource (from params) on remove', () => {
      expect(
        Reflect.getMetadata(
          RBAC_ACTION_KEY,
          WebhooksController.prototype.remove,
        ),
      ).toEqual([RbacActions.UPDATE_CHANNEL]);
      expect(
        Reflect.getMetadata(
          RBAC_RESOURCE_KEY,
          WebhooksController.prototype.remove,
        ),
      ).toEqual({
        type: RbacResourceType.CHANNEL,
        idKey: 'channelId',
        source: ResourceIdSource.PARAM,
      });
    });
  });

  describe('create', () => {
    it('delegates to the service with the authenticated user as creator', async () => {
      const dto = { name: 'CI Bot' };
      const req = { user: { id: 'user-1' } } as any;
      const created = { id: 'wh-1', url: 'https://x/api/webhooks/wh-1/tok' };
      webhooksService.create.mockResolvedValue(created as any);

      const result = await controller.create('channel-1', dto, req);

      expect(result).toEqual(created);
      expect(webhooksService.create).toHaveBeenCalledWith(
        'channel-1',
        dto,
        'user-1',
      );
    });
  });

  describe('findAllForChannel', () => {
    it('delegates to the service', async () => {
      const list = [{ id: 'wh-1' }];
      webhooksService.listForChannel.mockResolvedValue(list as any);

      const result = await controller.findAllForChannel('channel-1');

      expect(result).toEqual(list);
      expect(webhooksService.listForChannel).toHaveBeenCalledWith('channel-1');
    });
  });

  describe('remove', () => {
    it('delegates to the service with channel and webhook ids', async () => {
      webhooksService.remove.mockResolvedValue(undefined);

      const result = await controller.remove('channel-1', 'wh-1');

      expect(result).toBeUndefined();
      expect(webhooksService.remove).toHaveBeenCalledWith('channel-1', 'wh-1');
    });
  });
});

describe('WebhookExecutionController', () => {
  let controller: WebhookExecutionController;
  let webhooksService: Mocked<WebhooksService>;

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(
      WebhookExecutionController,
    ).compile();

    controller = unit;
    webhooksService = unitRef.get(WebhooksService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is public (no auth required)', () => {
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        WebhookExecutionController.prototype.execute,
      ),
    ).toBe(true);
  });

  it('is throttled with the short and long limits from the brief', () => {
    expect(
      Reflect.getMetadata(
        THROTTLER_LIMIT + 'short',
        WebhookExecutionController.prototype.execute,
      ),
    ).toBe(4);
    expect(
      Reflect.getMetadata(
        THROTTLER_TTL + 'short',
        WebhookExecutionController.prototype.execute,
      ),
    ).toBe(1000);
    expect(
      Reflect.getMetadata(
        THROTTLER_LIMIT + 'long',
        WebhookExecutionController.prototype.execute,
      ),
    ).toBe(30);
    expect(
      Reflect.getMetadata(
        THROTTLER_TTL + 'long',
        WebhookExecutionController.prototype.execute,
      ),
    ).toBe(60000);
  });

  it('has no RBAC action metadata (public, unauthenticated route)', () => {
    expect(
      Reflect.getMetadata(
        RBAC_ACTION_KEY,
        WebhookExecutionController.prototype.execute,
      ),
    ).toBeUndefined();
  });

  it('delegates to the service with id, token, and content', async () => {
    webhooksService.execute.mockResolvedValue({ id: 'message-1' });

    const result = await controller.execute('wh-1', 'tok-1', {
      content: 'hello',
    });

    expect(result).toEqual({ id: 'message-1' });
    expect(webhooksService.execute).toHaveBeenCalledWith(
      'wh-1',
      'tok-1',
      'hello',
    );
  });
});
