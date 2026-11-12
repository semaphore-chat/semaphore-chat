import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ResourceType } from '@prisma/client';
import { SoundboardService } from './soundboard.service';
import { DatabaseService } from '@/database/database.service';
import { FileUploadService } from '@/file-upload/file-upload.service';
import { createMockDatabase } from '@/test-utils';
import { RoomEvents } from '@/rooms/room-subscription.events';

describe('SoundboardService', () => {
  let service: SoundboardService;
  let mockDatabase: ReturnType<typeof createMockDatabase>;
  let fileUploadService: Mocked<FileUploadService>;
  let eventEmitter: Mocked<EventEmitter2>;

  const communityId = 'community-1';
  const userId = 'user-1';
  const fileId = 'file-1';

  const buildSound = (overrides = {}) => ({
    id: 'sound-1',
    communityId,
    name: 'airhorn',
    emoji: '📯',
    fileId,
    createdBy: userId,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  });

  const buildFile = (overrides = {}) => ({
    id: fileId,
    resourceType: ResourceType.SOUNDBOARD_SOUND,
    fileCommunityId: communityId,
    deletedAt: null,
    ...overrides,
  });

  beforeEach(async () => {
    mockDatabase = createMockDatabase();

    const { unit, unitRef } = await TestBed.solitary(SoundboardService)
      .mock(DatabaseService)
      .final(mockDatabase)
      .compile();

    service = unit;
    fileUploadService = unitRef.get(FileUploadService);
    eventEmitter = unitRef.get(EventEmitter2);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('listCommunitySounds', () => {
    it('returns all sounds for a community as DTOs', async () => {
      mockDatabase.soundboardSound.findMany.mockResolvedValue([
        buildSound(),
        buildSound({ id: 'sound-2', name: 'boo', emoji: null }),
      ]);

      const result = await service.listCommunitySounds(communityId);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(
        expect.objectContaining({
          id: 'sound-1',
          name: 'airhorn',
          emoji: '📯',
        }),
      );
      expect(mockDatabase.soundboardSound.findMany).toHaveBeenCalledWith({
        where: { communityId },
        orderBy: { name: 'asc' },
      });
    });
  });

  describe('createSound', () => {
    const dto = { name: 'airhorn', emoji: '📯', fileId };

    it('creates a sound when name is unique and file is valid', async () => {
      mockDatabase.soundboardSound.findUnique.mockResolvedValue(null);
      mockDatabase.file.findUnique.mockResolvedValue(buildFile());
      mockDatabase.soundboardSound.findFirst.mockResolvedValue(null);
      mockDatabase.soundboardSound.create.mockResolvedValue(buildSound());

      const result = await service.createSound(communityId, userId, dto);

      expect(result.name).toBe('airhorn');
      expect(mockDatabase.soundboardSound.create).toHaveBeenCalledWith({
        data: {
          communityId,
          name: 'airhorn',
          emoji: '📯',
          fileId,
          createdBy: userId,
        },
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        RoomEvents.SOUNDBOARD_SOUND_CREATED,
        { communityId, soundId: 'sound-1' },
      );
    });

    it('throws ConflictException when the name already exists', async () => {
      mockDatabase.soundboardSound.findUnique.mockResolvedValue(buildSound());

      await expect(
        service.createSound(communityId, userId, dto),
      ).rejects.toThrow(ConflictException);
      expect(mockDatabase.soundboardSound.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the file does not exist', async () => {
      mockDatabase.soundboardSound.findUnique.mockResolvedValue(null);
      mockDatabase.file.findUnique.mockResolvedValue(null);

      await expect(
        service.createSound(communityId, userId, dto),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when the file belongs to another community', async () => {
      mockDatabase.soundboardSound.findUnique.mockResolvedValue(null);
      mockDatabase.file.findUnique.mockResolvedValue(
        buildFile({ fileCommunityId: 'other-community' }),
      );

      await expect(
        service.createSound(communityId, userId, dto),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when the file is not a soundboard file', async () => {
      mockDatabase.soundboardSound.findUnique.mockResolvedValue(null);
      mockDatabase.file.findUnique.mockResolvedValue(
        buildFile({ resourceType: ResourceType.CUSTOM_EMOJI }),
      );

      await expect(
        service.createSound(communityId, userId, dto),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when the file is already used by another sound', async () => {
      mockDatabase.soundboardSound.findUnique.mockResolvedValue(null);
      mockDatabase.file.findUnique.mockResolvedValue(buildFile());
      mockDatabase.soundboardSound.findFirst.mockResolvedValue(
        buildSound({ id: 'other-sound' }),
      );

      await expect(
        service.createSound(communityId, userId, dto),
      ).rejects.toThrow(ConflictException);
    });

    it('translates a concurrent P2002 unique violation into ConflictException', async () => {
      mockDatabase.soundboardSound.findUnique.mockResolvedValue(null);
      mockDatabase.file.findUnique.mockResolvedValue(buildFile());
      mockDatabase.soundboardSound.findFirst.mockResolvedValue(null);
      mockDatabase.soundboardSound.create.mockRejectedValue(
        Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.createSound(communityId, userId, dto),
      ).rejects.toThrow(ConflictException);
    });

    it('rethrows non-P2002 create errors unchanged', async () => {
      mockDatabase.soundboardSound.findUnique.mockResolvedValue(null);
      mockDatabase.file.findUnique.mockResolvedValue(buildFile());
      mockDatabase.soundboardSound.findFirst.mockResolvedValue(null);
      mockDatabase.soundboardSound.create.mockRejectedValue(
        new Error('db down'),
      );

      await expect(
        service.createSound(communityId, userId, dto),
      ).rejects.toThrow('db down');
    });
  });

  describe('deleteSound', () => {
    it('deletes the sound and soft-deletes the backing file as the uploader (quota credited)', async () => {
      mockDatabase.soundboardSound.findUnique.mockResolvedValue(buildSound());
      mockDatabase.file.findUnique.mockResolvedValue({
        uploadedById: 'uploader-9',
        deletedAt: null,
      });
      mockDatabase.soundboardSound.delete.mockResolvedValue(buildSound());
      fileUploadService.remove.mockResolvedValue(undefined as never);

      await service.deleteSound(communityId, 'sound-1');

      expect(mockDatabase.soundboardSound.delete).toHaveBeenCalledWith({
        where: { id: 'sound-1' },
      });
      // Soft-delete path with the UPLOADER's id, not the deleter's
      expect(fileUploadService.remove).toHaveBeenCalledWith(
        fileId,
        'uploader-9',
      );
      // Never hard-deletes the file row
      expect(mockDatabase.file.delete).not.toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        RoomEvents.SOUNDBOARD_SOUND_DELETED,
        { communityId, soundId: 'sound-1' },
      );
    });

    it('falls back to a direct soft-delete when the uploader was deleted (uploadedById null)', async () => {
      mockDatabase.soundboardSound.findUnique.mockResolvedValue(buildSound());
      mockDatabase.file.findUnique.mockResolvedValue({
        uploadedById: null,
        deletedAt: null,
      });
      mockDatabase.soundboardSound.delete.mockResolvedValue(buildSound());

      await service.deleteSound(communityId, 'sound-1');

      expect(fileUploadService.remove).not.toHaveBeenCalled();
      expect(mockDatabase.file.update).toHaveBeenCalledWith({
        where: { id: fileId },
        data: { deletedAt: expect.any(Date) },
      });
      expect(mockDatabase.file.delete).not.toHaveBeenCalled();
    });

    it('skips file cleanup when the backing file is already soft-deleted', async () => {
      mockDatabase.soundboardSound.findUnique.mockResolvedValue(buildSound());
      mockDatabase.file.findUnique.mockResolvedValue({
        uploadedById: 'uploader-9',
        deletedAt: new Date(),
      });
      mockDatabase.soundboardSound.delete.mockResolvedValue(buildSound());

      await service.deleteSound(communityId, 'sound-1');

      expect(fileUploadService.remove).not.toHaveBeenCalled();
      expect(mockDatabase.file.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the sound does not exist', async () => {
      mockDatabase.soundboardSound.findUnique.mockResolvedValue(null);

      await expect(service.deleteSound(communityId, 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the sound belongs to another community', async () => {
      mockDatabase.soundboardSound.findUnique.mockResolvedValue(
        buildSound({ communityId: 'other-community' }),
      );

      await expect(service.deleteSound(communityId, 'sound-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockDatabase.soundboardSound.delete).not.toHaveBeenCalled();
    });

    it('still resolves when backing file soft-deletion fails', async () => {
      mockDatabase.soundboardSound.findUnique.mockResolvedValue(buildSound());
      mockDatabase.file.findUnique.mockResolvedValue({
        uploadedById: 'uploader-9',
        deletedAt: null,
      });
      mockDatabase.soundboardSound.delete.mockResolvedValue(buildSound());
      fileUploadService.remove.mockRejectedValue(new Error('file gone'));

      await expect(
        service.deleteSound(communityId, 'sound-1'),
      ).resolves.toBeUndefined();
    });
  });
});
