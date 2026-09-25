import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { CommunityController } from './community.controller';
import { CommunityService } from './community.service';

describe('CommunityController', () => {
  let controller: CommunityController;
  let service: Mocked<CommunityService>;

  beforeEach(async () => {
    const { unit, unitRef } =
      await TestBed.solitary(CommunityController).compile();

    controller = unit;
    service = unitRef.get(CommunityService);
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

  describe('create', () => {
    it('should create a community', async () => {
      const createDto = {
        name: 'Test Community',
        description: 'A test community',
      };
      const mockUser = { id: 'user-123', username: 'testuser' };
      const mockReq = { user: mockUser } as any;
      const createdCommunity = {
        id: 'community-123',
        ...createDto,
        ownerId: 'user-123',
      };

      service.create.mockResolvedValue(createdCommunity as any);

      const result = await controller.create(createDto, mockReq);

      expect(result).toEqual(createdCommunity);
      expect(service.create).toHaveBeenCalledWith(createDto, 'user-123');
    });
  });

  describe('findAll', () => {
    it('should return all communities', async () => {
      const communities = [
        { id: 'community-1', name: 'Community 1' },
        { id: 'community-2', name: 'Community 2' },
      ];

      service.findAll.mockResolvedValue(communities as any);

      const result = await controller.findAll();

      expect(result).toEqual(communities);
      expect(service.findAll).toHaveBeenCalledWith();
    });
  });

  describe('findAllMine', () => {
    it('should return user communities', async () => {
      const mockUser = { id: 'user-456' };
      const mockReq = { user: mockUser } as any;
      const communities = [
        { id: 'community-1', name: 'My Community 1' },
        { id: 'community-2', name: 'My Community 2' },
      ];

      service.findAll.mockResolvedValue(communities as any);

      const result = await controller.findAllMine(mockReq);

      expect(result).toEqual(communities);
      expect(service.findAll).toHaveBeenCalledWith('user-456');
    });
  });

  describe('findOne', () => {
    it('should return a single community', async () => {
      const communityId = 'community-999';
      const community = {
        id: communityId,
        name: 'Specific Community',
        description: 'A specific community',
      };

      service.findOne.mockResolvedValue(community as any);

      const result = await controller.findOne(communityId);

      expect(result).toEqual(community);
      expect(service.findOne).toHaveBeenCalledWith(communityId);
    });
  });

  describe('update', () => {
    it('should update a community', async () => {
      const communityId = 'community-111';
      const updateDto = { name: 'Updated Community Name' };
      const updatedCommunity = {
        id: communityId,
        ...updateDto,
        description: 'Original description',
      };

      service.update.mockResolvedValue(updatedCommunity as any);

      const result = await controller.update(communityId, updateDto);

      expect(result).toEqual(updatedCommunity);
      expect(service.update).toHaveBeenCalledWith(communityId, updateDto);
    });
  });

  describe('remove', () => {
    it('should remove a community', async () => {
      const communityId = 'community-222';

      service.remove.mockResolvedValue(undefined);

      const result = await controller.remove(communityId);

      expect(result).toBeUndefined();
      expect(service.remove).toHaveBeenCalledWith(communityId);
    });
  });
});
