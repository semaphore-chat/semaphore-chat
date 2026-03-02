import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { FileAccessGuard } from './file-access.guard';
import { FileService } from '@/file/file.service';
import { MembershipService } from '@/membership/membership.service';
import { ChannelMembershipService } from '@/channel-membership/channel-membership.service';
import { DatabaseService } from '@/database/database.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ResourceType } from '@prisma/client';
import {
  UserFactory,
  FileFactory,
  createMockDatabase,
  createMockHttpExecutionContext,
} from '@/test-utils';

describe('FileAccessGuard', () => {
  let guard: FileAccessGuard;
  let fileService: Mocked<FileService>;
  let membershipService: Mocked<MembershipService>;
  let channelMembershipService: Mocked<ChannelMembershipService>;
  let mockDatabase: any;

  beforeEach(async () => {
    mockDatabase = createMockDatabase();

    const { unit, unitRef } = await TestBed.solitary(FileAccessGuard)
      .mock(DatabaseService)
      .final(mockDatabase)
      .compile();

    guard = unit;
    fileService = unitRef.get(FileService);
    membershipService = unitRef.get(MembershipService);
    channelMembershipService = unitRef.get(ChannelMembershipService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('No file ID', () => {
    it('should throw NotFoundException when no fileId provided', async () => {
      const user = UserFactory.build();
      const context = createMockHttpExecutionContext({
        user,
        params: {},
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        NotFoundException,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        'File ID not provided',
      );
    });
  });

  describe('Public files (no resource FK)', () => {
    it('should allow access to files with no resource FK', async () => {
      const user = UserFactory.build();
      const file = FileFactory.build({
        resourceType: ResourceType.USER_AVATAR,
      });
      const context = createMockHttpExecutionContext({
        user,
        params: { id: file.id },
      });

      fileService.findOne.mockResolvedValue(file);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(fileService.findOne).toHaveBeenCalledWith(file.id);
    });

    it('should allow unauthenticated access to files with no resource FK', async () => {
      const file = FileFactory.build({
        resourceType: ResourceType.USER_AVATAR,
      });

      const mockContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue({
            user: undefined,
            params: { id: file.id },
          }),
        }),
        getType: jest.fn().mockReturnValue('http'),
        getClass: jest.fn(),
        getHandler: jest.fn(),
        getArgs: jest.fn(),
        getArgByIndex: jest.fn(),
        switchToRpc: jest.fn(),
        switchToWs: jest.fn(),
      } as any;

      fileService.findOne.mockResolvedValue(file);

      const result = await guard.canActivate(mockContext);

      expect(result).toBe(true);
    });
  });

  describe('Public access strategy (user avatars/banners)', () => {
    it('should allow access to user avatars for authenticated users', async () => {
      const user = UserFactory.build();
      const file = FileFactory.build({
        fileUserId: 'other-user-id',
        resourceType: ResourceType.USER_AVATAR,
      });
      const context = createMockHttpExecutionContext({
        user,
        params: { id: file.id },
      });

      fileService.findOne.mockResolvedValue(file);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should allow access to user banners for authenticated users', async () => {
      const user = UserFactory.build();
      const file = FileFactory.build({
        fileUserId: 'other-user-id',
        resourceType: ResourceType.USER_BANNER,
      });
      const context = createMockHttpExecutionContext({
        user,
        params: { id: file.id },
      });

      fileService.findOne.mockResolvedValue(file);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });
  });

  describe('Community membership strategy', () => {
    it('should allow access to community avatar for community members', async () => {
      const user = UserFactory.build();
      const communityId = 'community-123';
      const file = FileFactory.build({
        fileCommunityId: communityId,
        resourceType: ResourceType.COMMUNITY_AVATAR,
      });
      const context = createMockHttpExecutionContext({
        user,
        params: { id: file.id },
      });

      fileService.findOne.mockResolvedValue(file);
      membershipService.isMember.mockResolvedValue(true);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(membershipService.isMember).toHaveBeenCalledWith(
        user.id,
        communityId,
      );
    });

    it('should deny access to community banner for non-members', async () => {
      const user = UserFactory.build();
      const communityId = 'community-456';
      const file = FileFactory.build({
        fileCommunityId: communityId,
        resourceType: ResourceType.COMMUNITY_BANNER,
      });
      const context = createMockHttpExecutionContext({
        user,
        params: { id: file.id },
      });

      fileService.findOne.mockResolvedValue(file);
      membershipService.isMember.mockResolvedValue(false);

      await expect(guard.canActivate(context)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        'You must be a member of this community',
      );
    });

    it('should allow access to custom emojis for community members', async () => {
      const user = UserFactory.build();
      const communityId = 'community-789';
      const file = FileFactory.build({
        fileCommunityId: communityId,
        resourceType: ResourceType.CUSTOM_EMOJI,
      });
      const context = createMockHttpExecutionContext({
        user,
        params: { id: file.id },
      });

      fileService.findOne.mockResolvedValue(file);
      membershipService.isMember.mockResolvedValue(true);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });
  });

  describe('Message attachment strategy - channel messages', () => {
    it('should allow access to public channel message attachments for community members', async () => {
      const user = UserFactory.build();
      const messageId = 'message-123';
      const channelId = 'channel-456';
      const communityId = 'community-789';
      const file = FileFactory.build({
        fileMessageId: messageId,
        resourceType: ResourceType.MESSAGE_ATTACHMENT,
      });
      const context = createMockHttpExecutionContext({
        user,
        params: { id: file.id },
      });

      fileService.findOne.mockResolvedValue(file);
      mockDatabase.message.findUnique.mockResolvedValue({
        id: messageId,
        channelId,
        directMessageGroupId: null,
      });
      mockDatabase.channel.findUnique.mockResolvedValue({
        id: channelId,
        communityId,
        isPrivate: false,
      });
      membershipService.isMember.mockResolvedValue(true);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(membershipService.isMember).toHaveBeenCalledWith(
        user.id,
        communityId,
      );
    });

    it('should deny access to public channel messages for non-community members', async () => {
      const user = UserFactory.build();
      const messageId = 'message-123';
      const channelId = 'channel-456';
      const communityId = 'community-789';
      const file = FileFactory.build({
        fileMessageId: messageId,
        resourceType: ResourceType.MESSAGE_ATTACHMENT,
      });
      const context = createMockHttpExecutionContext({
        user,
        params: { id: file.id },
      });

      fileService.findOne.mockResolvedValue(file);
      mockDatabase.message.findUnique.mockResolvedValue({
        id: messageId,
        channelId,
        directMessageGroupId: null,
      });
      mockDatabase.channel.findUnique.mockResolvedValue({
        id: channelId,
        communityId,
        isPrivate: false,
      });
      membershipService.isMember.mockResolvedValue(false);

      await expect(guard.canActivate(context)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        'You must be a member of this community',
      );
    });

    it('should allow access to private channel messages for channel members', async () => {
      const user = UserFactory.build();
      const messageId = 'message-private';
      const channelId = 'channel-private';
      const communityId = 'community-123';
      const file = FileFactory.build({
        fileMessageId: messageId,
        resourceType: ResourceType.MESSAGE_ATTACHMENT,
      });
      const context = createMockHttpExecutionContext({
        user,
        params: { id: file.id },
      });

      fileService.findOne.mockResolvedValue(file);
      mockDatabase.message.findUnique.mockResolvedValue({
        id: messageId,
        channelId,
        directMessageGroupId: null,
      });
      mockDatabase.channel.findUnique.mockResolvedValue({
        id: channelId,
        communityId,
        isPrivate: true,
      });
      channelMembershipService.isMember.mockResolvedValue(true);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(channelMembershipService.isMember).toHaveBeenCalledWith(
        user.id,
        channelId,
      );
      expect(membershipService.isMember).not.toHaveBeenCalled();
    });

    it('should deny access to private channel messages for non-channel members', async () => {
      const user = UserFactory.build();
      const messageId = 'message-private';
      const channelId = 'channel-private';
      const communityId = 'community-123';
      const file = FileFactory.build({
        fileMessageId: messageId,
        resourceType: ResourceType.MESSAGE_ATTACHMENT,
      });
      const context = createMockHttpExecutionContext({
        user,
        params: { id: file.id },
      });

      fileService.findOne.mockResolvedValue(file);
      mockDatabase.message.findUnique.mockResolvedValue({
        id: messageId,
        channelId,
        directMessageGroupId: null,
      });
      mockDatabase.channel.findUnique.mockResolvedValue({
        id: channelId,
        communityId,
        isPrivate: true,
      });
      channelMembershipService.isMember.mockResolvedValue(false);

      await expect(guard.canActivate(context)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        'You must be a member of this private channel',
      );
    });
  });

  describe('Message attachment strategy - DM messages', () => {
    it('should allow access to DM attachments for DM group members', async () => {
      const user = UserFactory.build();
      const messageId = 'dm-message-123';
      const dmGroupId = 'dm-group-456';
      const file = FileFactory.build({
        fileMessageId: messageId,
        resourceType: ResourceType.MESSAGE_ATTACHMENT,
      });
      const context = createMockHttpExecutionContext({
        user,
        params: { id: file.id },
      });

      fileService.findOne.mockResolvedValue(file);
      mockDatabase.message.findUnique.mockResolvedValue({
        id: messageId,
        channelId: null,
        directMessageGroupId: dmGroupId,
      });
      mockDatabase.directMessageGroupMember.findUnique.mockResolvedValue({
        groupId: dmGroupId,
        userId: user.id,
      });

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(
        mockDatabase.directMessageGroupMember.findUnique,
      ).toHaveBeenCalledWith({
        where: {
          groupId_userId: {
            groupId: dmGroupId,
            userId: user.id,
          },
        },
      });
    });

    it('should deny access to DM attachments for non-members', async () => {
      const user = UserFactory.build();
      const messageId = 'dm-message-123';
      const dmGroupId = 'dm-group-456';
      const file = FileFactory.build({
        fileMessageId: messageId,
        resourceType: ResourceType.MESSAGE_ATTACHMENT,
      });
      const context = createMockHttpExecutionContext({
        user,
        params: { id: file.id },
      });

      fileService.findOne.mockResolvedValue(file);
      mockDatabase.message.findUnique.mockResolvedValue({
        id: messageId,
        channelId: null,
        directMessageGroupId: dmGroupId,
      });
      mockDatabase.directMessageGroupMember.findUnique.mockResolvedValue(null);

      await expect(guard.canActivate(context)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        'You must be a member of this conversation',
      );
    });
  });

  describe('Error scenarios', () => {
    it('should throw ForbiddenException when user not authenticated for resource files', async () => {
      const file = FileFactory.build({
        fileCommunityId: 'community-123',
        resourceType: ResourceType.COMMUNITY_AVATAR,
      });
      const mockContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue({
            user: undefined,
            params: { id: file.id },
          }),
        }),
        getType: jest.fn().mockReturnValue('http'),
        getClass: jest.fn(),
        getHandler: jest.fn(),
        getArgs: jest.fn(),
        getArgByIndex: jest.fn(),
        switchToRpc: jest.fn(),
        switchToWs: jest.fn(),
      } as any;

      fileService.findOne.mockResolvedValue(file);

      await expect(guard.canActivate(mockContext)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(guard.canActivate(mockContext)).rejects.toThrow(
        'Authentication required',
      );
    });

    it('should throw NotFoundException when file not found', async () => {
      const user = UserFactory.build();
      const context = createMockHttpExecutionContext({
        user,
        params: { id: 'nonexistent-file' },
      });

      fileService.findOne.mockRejectedValue(
        new NotFoundException('File not found'),
      );

      await expect(guard.canActivate(context)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when message not found for attachment', async () => {
      const user = UserFactory.build();
      const file = FileFactory.build({
        fileMessageId: 'nonexistent-message',
        resourceType: ResourceType.MESSAGE_ATTACHMENT,
      });
      const context = createMockHttpExecutionContext({
        user,
        params: { id: file.id },
      });

      fileService.findOne.mockResolvedValue(file);
      mockDatabase.message.findUnique.mockResolvedValue(null);

      await expect(guard.canActivate(context)).rejects.toThrow(
        NotFoundException,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Message not found',
      );
    });

    it('should throw NotFoundException when channel not found', async () => {
      const user = UserFactory.build();
      const messageId = 'message-123';
      const channelId = 'nonexistent-channel';
      const file = FileFactory.build({
        fileMessageId: messageId,
        resourceType: ResourceType.MESSAGE_ATTACHMENT,
      });
      const context = createMockHttpExecutionContext({
        user,
        params: { id: file.id },
      });

      fileService.findOne.mockResolvedValue(file);
      mockDatabase.message.findUnique.mockResolvedValue({
        id: messageId,
        channelId,
        directMessageGroupId: null,
      });
      mockDatabase.channel.findUnique.mockResolvedValue(null);

      await expect(guard.canActivate(context)).rejects.toThrow(
        NotFoundException,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Channel not found',
      );
    });

    it('should throw ForbiddenException for unknown resource type', async () => {
      const user = UserFactory.build();
      const file = FileFactory.build({
        fileUserId: 'resource-123',
        resourceType: 'UNKNOWN_TYPE' as any,
      });
      const context = createMockHttpExecutionContext({
        user,
        params: { id: file.id },
      });

      fileService.findOne.mockResolvedValue(file);

      await expect(guard.canActivate(context)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(guard.canActivate(context)).rejects.toThrow('Access denied');
    });

    it('should throw NotFoundException for general errors', async () => {
      const user = UserFactory.build();
      const context = createMockHttpExecutionContext({
        user,
        params: { id: 'file-123' },
      });

      fileService.findOne.mockRejectedValue(
        new Error('Database connection lost'),
      );

      await expect(guard.canActivate(context)).rejects.toThrow(
        NotFoundException,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        'File not found',
      );
    });
  });
});
