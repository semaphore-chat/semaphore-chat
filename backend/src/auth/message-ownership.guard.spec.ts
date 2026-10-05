import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { InstanceRole, RbacActions } from '@prisma/client';
import { MessageOwnershipGuard } from './message-ownership.guard';
import { MessagesService } from '@/messages/messages.service';
import { PermissionsService } from '@/roles/permissions.service';
import { RbacResourceType } from './rbac-resource.decorator';
import {
  UserFactory,
  MessageFactory,
  createMockHttpExecutionContext,
} from '@/test-utils';

describe('MessageOwnershipGuard', () => {
  let guard: MessageOwnershipGuard;
  let messagesService: Mocked<MessagesService>;
  let permissionsService: Mocked<PermissionsService>;

  const ctx = (method: string, user: any, id = 'm1') =>
    createMockHttpExecutionContext({ user, params: { id }, method });

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(
      MessageOwnershipGuard,
    ).compile();
    guard = unit;
    messagesService = unitRef.get(MessagesService);
    permissionsService = unitRef.get(PermissionsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('author', () => {
    it.each(['PATCH', 'DELETE', 'POST'])('is allowed %s', async (method) => {
      const user = UserFactory.build();
      messagesService.findOne.mockResolvedValue(
        MessageFactory.build({ authorId: user.id }) as any,
      );
      await expect(guard.canActivate(ctx(method, user))).resolves.toBe(true);
      expect(
        permissionsService.verifyActionsForUserAndResource,
      ).not.toHaveBeenCalled();
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
