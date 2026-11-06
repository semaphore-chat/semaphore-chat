import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { InstanceRole, RbacActions } from '@prisma/client';
import { MessageOwnershipGuard } from './message-ownership.guard';
import { MessagesService } from '@/messages/messages.service';
import { PermissionsService } from '@/roles/permissions.service';
import { DatabaseService } from '@/database/database.service';
import { RbacResourceType } from './rbac-resource.decorator';
import {
  UserFactory,
  MessageFactory,
  createMockDatabase,
  createMockHttpExecutionContext,
} from '@/test-utils';

describe('MessageOwnershipGuard', () => {
  let guard: MessageOwnershipGuard;
  let messagesService: Mocked<MessagesService>;
  let permissionsService: Mocked<PermissionsService>;
  let mockDatabase: ReturnType<typeof createMockDatabase>;

  const ctx = (method: string, user: any, id = 'm1') =>
    createMockHttpExecutionContext({ user, params: { id }, method });

  beforeEach(async () => {
    mockDatabase = createMockDatabase();
    const { unit, unitRef } = await TestBed.solitary(MessageOwnershipGuard)
      .mock(DatabaseService)
      .final(mockDatabase)
      .compile();
    guard = unit;
    messagesService = unitRef.get(MessagesService);
    permissionsService = unitRef.get(PermissionsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('author', () => {
    const user = UserFactory.build();
    const own = (fields: Record<string, unknown> = {}) =>
      messagesService.findOne.mockResolvedValue(
        MessageFactory.build({
          authorId: user.id,
          channelId: 'channel-1',
          directMessageGroupId: null,
          deletedAt: null,
          ...fields,
        }) as any,
      );
    const inDm = {
      channelId: null,
      directMessageGroupId: 'dm-1',
    };

    it.each(['PATCH', 'POST'])(
      'is allowed %s with CREATE_MESSAGE in the channel',
      async (method) => {
        own();
        permissionsService.userHasChannelActions.mockResolvedValue(true);
        await expect(guard.canActivate(ctx(method, user))).resolves.toBe(true);
        expect(permissionsService.userHasChannelActions).toHaveBeenCalledWith(
          user.id,
          'channel-1',
          [RbacActions.CREATE_MESSAGE],
        );
      },
    );

    it.each(['PATCH', 'POST'])(
      'is denied %s without CREATE_MESSAGE in the channel',
      async (method) => {
        own();
        permissionsService.userHasChannelActions.mockResolvedValue(false);
        await expect(
          guard.canActivate(ctx(method, user)),
        ).rejects.toBeInstanceOf(ForbiddenException);
      },
    );

    it.each(['PATCH', 'POST'])(
      'is denied %s on a message a moderator removed',
      async (method) => {
        own({ deletedAt: new Date() });
        permissionsService.userHasChannelActions.mockResolvedValue(true);
        await expect(
          guard.canActivate(ctx(method, user)),
        ).rejects.toBeInstanceOf(ForbiddenException);
      },
    );

    it('is denied PATCH on a message with neither a channel nor a DM', async () => {
      own({ channelId: null });
      await expect(
        guard.canActivate(ctx('PATCH', user)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('is allowed DELETE whatever access they have left', async () => {
      own({ deletedAt: new Date() });
      await expect(guard.canActivate(ctx('DELETE', user))).resolves.toBe(true);
      expect(permissionsService.userHasChannelActions).not.toHaveBeenCalled();
      expect(
        permissionsService.verifyActionsForUserAndResource,
      ).not.toHaveBeenCalled();
    });

    describe('in a DM', () => {
      const members = (...ids: string[]) =>
        mockDatabase.directMessageGroup.findUnique.mockResolvedValue({
          isGroup: false,
          members: ids.map((userId) => ({ userId })),
        });

      it('is allowed PATCH as a current member', async () => {
        own(inDm);
        mockDatabase.directMessageGroupMember.findFirst.mockResolvedValue({
          id: 'm',
        });
        members(user.id, 'other');
        mockDatabase.userBlock.findFirst.mockResolvedValue(null);
        await expect(guard.canActivate(ctx('PATCH', user))).resolves.toBe(true);
        expect(permissionsService.userHasChannelActions).not.toHaveBeenCalled();
      });

      it('is denied PATCH after leaving, an instance owner too', async () => {
        const owner = UserFactory.build({ role: InstanceRole.OWNER });
        messagesService.findOne.mockResolvedValue(
          MessageFactory.build({
            authorId: owner.id,
            deletedAt: null,
            ...inDm,
          }) as any,
        );
        mockDatabase.directMessageGroupMember.findFirst.mockResolvedValue(null);
        await expect(
          guard.canActivate(ctx('PATCH', owner)),
        ).rejects.toBeInstanceOf(ForbiddenException);
      });

      it('is denied PATCH when blocked in a 1:1', async () => {
        own(inDm);
        mockDatabase.directMessageGroupMember.findFirst.mockResolvedValue({
          id: 'm',
        });
        members(user.id, 'other');
        mockDatabase.userBlock.findFirst.mockResolvedValue({ id: 'b' });
        await expect(
          guard.canActivate(ctx('PATCH', user)),
        ).rejects.toBeInstanceOf(ForbiddenException);
      });
    });
  });

  describe('non-author', () => {
    const other = () =>
      MessageFactory.build({ authorId: 'someone-else' }) as any;

    it.each(['PATCH', 'POST'])('is denied %s', async (method) => {
      messagesService.findOne.mockResolvedValue(other());
      permissionsService.verifyActionsForUserAndResource.mockResolvedValue(
        true,
      );
      await expect(
        guard.canActivate(ctx(method, UserFactory.build())),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('is allowed DELETE with DELETE_ANY_MESSAGE', async () => {
      const user = UserFactory.build();
      const message = other();
      messagesService.findOne.mockResolvedValue(message);
      permissionsService.verifyActionsForUserAndResource.mockResolvedValue(
        true,
      );
      await expect(
        guard.canActivate(ctx('DELETE', user, message.id)),
      ).resolves.toBe(true);
      expect(
        permissionsService.verifyActionsForUserAndResource,
      ).toHaveBeenCalledWith(user.id, message.id, RbacResourceType.MESSAGE, [
        RbacActions.DELETE_ANY_MESSAGE,
      ]);
    });

    it('is denied DELETE without DELETE_ANY_MESSAGE', async () => {
      messagesService.findOne.mockResolvedValue(other());
      permissionsService.verifyActionsForUserAndResource.mockResolvedValue(
        false,
      );
      await expect(
        guard.canActivate(ctx('DELETE', UserFactory.build())),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('is denied DELETE of a DM message without consulting permissions', async () => {
      messagesService.findOne.mockResolvedValue(
        MessageFactory.build({
          authorId: 'someone-else',
          directMessageGroupId: 'dm-1',
        }) as any,
      );
      await expect(
        guard.canActivate(ctx('DELETE', UserFactory.build())),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(
        permissionsService.verifyActionsForUserAndResource,
      ).not.toHaveBeenCalled();
    });

    it('instance OWNER may DELETE', async () => {
      messagesService.findOne.mockResolvedValue(other());
      const owner = UserFactory.build({ role: InstanceRole.OWNER });
      await expect(guard.canActivate(ctx('DELETE', owner))).resolves.toBe(true);
    });
  });

  describe('edge cases', () => {
    it('does not allow a missing message through (404 propagates)', async () => {
      messagesService.findOne.mockRejectedValue(new NotFoundException());
      permissionsService.verifyActionsForUserAndResource.mockResolvedValue(
        true,
      );
      for (const method of ['PATCH', 'DELETE', 'POST']) {
        await expect(
          guard.canActivate(ctx(method, UserFactory.build())),
        ).rejects.toBeInstanceOf(NotFoundException);
      }
    });

    it('denies when there is no user', async () => {
      await expect(guard.canActivate(ctx('DELETE', null))).resolves.toBe(false);
    });

    it('denies when there is no message id', async () => {
      const context = createMockHttpExecutionContext({
        user: UserFactory.build(),
        params: {},
        method: 'DELETE',
      });
      await expect(guard.canActivate(context)).resolves.toBe(false);
    });
  });
});
