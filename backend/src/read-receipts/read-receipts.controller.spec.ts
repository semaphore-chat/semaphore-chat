import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { ReadReceiptsController } from './read-receipts.controller';
import { ReadReceiptsService } from './read-receipts.service';

describe('ReadReceiptsController', () => {
  let controller: ReadReceiptsController;
  let readReceiptsService: Mocked<ReadReceiptsService>;

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(
      ReadReceiptsController,
    ).compile();

    controller = unit;
    readReceiptsService = unitRef.get(ReadReceiptsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getDmPeerReads', () => {
    const directMessageGroupId = 'dm-group-123';
    const userId = 'user-789';
    const mockReq = { user: { id: userId } } as any;

    it('should pass correct args to service', async () => {
      const mockPeerReads = [
        { userId: 'peer-1', lastReadAt: new Date() },
      ];

      readReceiptsService.getDmPeerReads.mockResolvedValue(mockPeerReads);

      const result = await controller.getDmPeerReads(
        mockReq,
        directMessageGroupId,
      );

      expect(result).toEqual(mockPeerReads);
      expect(readReceiptsService.getDmPeerReads).toHaveBeenCalledWith(
        userId,
        directMessageGroupId,
      );
    });
  });

  describe('getMessageReaders', () => {
    const messageId = 'message-123';
    const channelId = 'channel-456';
    const userId = 'user-789';
    const mockReq = { user: { id: userId } } as any;

    it('should pass req.user.id as excludeUserId to the service', async () => {
      const mockReaders = [
        {
          userId: 'user-456',
          username: 'other',
          displayName: 'Other',
          avatarUrl: null,
          readAt: new Date(),
        },
      ];

      readReceiptsService.getMessageReaders.mockResolvedValue(mockReaders);

      const result = await controller.getMessageReaders(
        mockReq,
        messageId,
        channelId,
      );

      expect(result).toEqual(mockReaders);
      expect(readReceiptsService.getMessageReaders).toHaveBeenCalledWith(
        messageId,
        channelId,
        undefined,
        userId,
      );
    });

    it('should pass directMessageGroupId when provided instead of channelId', async () => {
      const directMessageGroupId = 'dm-group-123';
      const mockReaders = [
        {
          userId: 'user-456',
          username: 'other',
          displayName: 'Other',
          avatarUrl: null,
          readAt: new Date(),
        },
      ];

      readReceiptsService.getMessageReaders.mockResolvedValue(mockReaders);

      const result = await controller.getMessageReaders(
        mockReq,
        messageId,
        undefined,
        directMessageGroupId,
      );

      expect(result).toEqual(mockReaders);
      expect(readReceiptsService.getMessageReaders).toHaveBeenCalledWith(
        messageId,
        undefined,
        directMessageGroupId,
        userId,
      );
    });
  });
});
