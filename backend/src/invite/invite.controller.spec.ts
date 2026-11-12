import { TestBed } from '@suites/unit';
import { NotFoundException } from '@nestjs/common';
import { ErrorCode } from '@semaphore-chat/shared';
import { InviteController } from './invite.controller';
import { InviteService } from './invite.service';
import type { Mocked } from '@suites/doubles.jest';

describe('InviteController', () => {
  let controller: InviteController;
  let service: Mocked<InviteService>;

  beforeEach(async () => {
    const { unit, unitRef } =
      await TestBed.solitary(InviteController).compile();

    controller = unit;
    service = unitRef.get(InviteService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should have a service', () => {
    expect(service).toBeDefined();
  });

  describe('createInvite', () => {
    it('should create an invite', async () => {
      const mockUser = { id: 'user-123', username: 'testuser' };
      const mockReq = { user: mockUser } as any;
      const createDto = {
        maxUses: 10,
        validUntil: new Date('2025-12-31'),
        communityIds: ['community-1', 'community-2'],
      };
      const createdInvite = {
        id: 'invite-123',
        code: 'ABC123XYZ',
        maxUses: 10,
        uses: 0,
        validUntil: createDto.validUntil,
        createdById: 'user-123',
      };

      service.createInvite.mockResolvedValue(createdInvite as any);

      const result = await controller.createInvite(mockReq, createDto);

      expect(result).toEqual(createdInvite);
      expect(service.createInvite).toHaveBeenCalledWith(
        mockUser,
        10,
        createDto.validUntil,
        ['community-1', 'community-2'],
      );
    });
  });

  describe('getInvites', () => {
    it('should return all invites for user', async () => {
      const mockUser = { id: 'user-456' };
      const mockReq = { user: mockUser } as any;
      const invites = [
        { id: 'invite-1', code: 'CODE1', uses: 5, maxUses: 10 },
        { id: 'invite-2', code: 'CODE2', uses: 0, maxUses: 5 },
      ];

      service.getInvites.mockResolvedValue(invites as any);

      const result = await controller.getInvites(mockReq);

      expect(result).toEqual(invites);
      expect(service.getInvites).toHaveBeenCalledWith(mockUser, undefined);
    });

    it('should scope the list to a community when asked (#685)', async () => {
      const mockUser = { id: 'user-456' };
      const mockReq = { user: mockUser } as any;
      service.getInvites.mockResolvedValue([]);

      await controller.getInvites(mockReq, 'community-1');

      expect(service.getInvites).toHaveBeenCalledWith(mockUser, 'community-1');
    });
  });

  describe('getPublicInvite', () => {
    it('should return invite by code without authentication', async () => {
      const code = 'PUBLIC123';
      const invite = {
        id: 'invite-789',
        code: 'PUBLIC123',
        uses: 2,
        maxUses: 50,
      };

      service.getPublicInvite.mockResolvedValue(invite as any);

      const result = await controller.getPublicInvite(code);

      expect(result).toEqual(invite);
      expect(service.getPublicInvite).toHaveBeenCalledWith(code);
    });

    it('propagates the coded 404 for an unusable code', async () => {
      const code = 'NOTFOUND';
      const notFound = new NotFoundException('This invite link is invalid.', {
        description: 'Not Found',
        errorCode: ErrorCode.INVITE_NOT_FOUND,
      });
      service.getPublicInvite.mockRejectedValue(notFound);

      await expect(controller.getPublicInvite(code)).rejects.toBe(notFound);
      expect(service.getPublicInvite).toHaveBeenCalledWith(code);
    });
  });

  describe('getInvite', () => {
    it('should return invite by code with authentication', async () => {
      const code = 'AUTH456';
      const invite = {
        id: 'invite-999',
        code: 'AUTH456',
        uses: 3,
        maxUses: 10,
      };

      service.getInviteByCode.mockResolvedValue(invite as any);

      const result = await controller.getInvite(code);

      expect(result).toEqual(invite);
      expect(service.getInviteByCode).toHaveBeenCalledWith(code);
    });
  });

  describe('deleteInvite', () => {
    it('should delete an invite', async () => {
      const mockUser = { id: 'user-789' };
      const mockReq = { user: mockUser } as any;
      const code = 'DELETE123';

      service.deleteInvite.mockResolvedValue(undefined);

      const result = await controller.deleteInvite(mockReq, code);

      expect(result).toBeUndefined();
      expect(service.deleteInvite).toHaveBeenCalledWith(mockUser, code);
    });
  });
});
