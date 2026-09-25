import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { UserFactory } from '@/test-utils';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { NotFoundException } from '@nestjs/common';
import { UserEntity } from './dto/user-response.dto';
import { AdminUserEntity } from './dto/admin-user-response.dto';

describe('UserController', () => {
  let controller: UserController;
  let service: Mocked<UserService>;

  const mockUser = UserFactory.build();
  const mockRequest = {
    user: { id: mockUser.id },
  } as any;

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(UserController).compile();

    controller = unit;
    service = unitRef.get(UserService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('register', () => {
    it('should create a new user and return UserEntity', async () => {
      const createUserDto: CreateUserDto = {
        code: 'invite-code-123',
        username: 'newuser',
        password: 'password123',
        email: 'newuser@example.com',
      };

      const createdUser = UserFactory.build({
        username: 'newuser',
        email: 'newuser@example.com',
      });

      service.createUser.mockResolvedValue(createdUser);

      const result = await controller.register(createUserDto);

      expect(service.createUser).toHaveBeenCalledWith(
        'invite-code-123',
        'newuser',
        'password123',
        'newuser@example.com',
      );
      expect(result).toBeInstanceOf(UserEntity);
      expect(result.username).toBe('newuser');
    });

    it('should pass correct parameters to service', async () => {
      const createUserDto: CreateUserDto = {
        code: 'code-456',
        username: 'testuser',
        password: 'pass456',
        email: 'test@test.com',
      };

      service.createUser.mockResolvedValue(UserFactory.build());

      await controller.register(createUserDto);

      const callArgs = (service.createUser as jest.Mock).mock.calls[0];
      expect(callArgs).toEqual([
        'code-456',
        'testuser',
        'pass456',
        'test@test.com',
      ]);
    });
  });

  describe('getProfile', () => {
    it('should return user profile', async () => {
      const userProfile = UserFactory.build({ id: mockUser.id });

      service.findById.mockResolvedValue(userProfile);

      const result = await controller.getProfile(mockRequest);

      expect(service.findById).toHaveBeenCalledWith(mockUser.id);
      expect(result).toBeInstanceOf(UserEntity);
      expect(result.id).toBe(mockUser.id);
    });

    it('should throw NotFoundException when user not found', async () => {
      service.findById.mockResolvedValue(null);

      await expect(controller.getProfile(mockRequest)).rejects.toThrow(
        NotFoundException,
      );
      await expect(controller.getProfile(mockRequest)).rejects.toThrow(
        'User not found',
      );
    });
  });

  describe('updateProfile', () => {
    it('should update user profile and return updated user', async () => {
      const updateProfileDto: UpdateProfileDto = {
        displayName: 'New Display Name',
        avatar: 'new-avatar-url',
      };

      const updatedUser = new UserEntity(
        UserFactory.build({
          id: mockUser.id,
          displayName: 'New Display Name',
          avatarUrl: 'new-avatar-url',
        }),
      );

      service.updateProfile.mockResolvedValue(updatedUser);

      const result = await controller.updateProfile(
        mockRequest,
        updateProfileDto,
      );

      expect(service.updateProfile).toHaveBeenCalledWith(
        mockUser.id,
        updateProfileDto,
      );
      expect(result.displayName).toBe('New Display Name');
    });

    it('should pass user ID from request', async () => {
      const updateProfileDto: UpdateProfileDto = { displayName: 'Test' };

      service.updateProfile.mockResolvedValue(
        new UserEntity(UserFactory.build()),
      );

      await controller.updateProfile(mockRequest, updateProfileDto);

      expect(service.updateProfile).toHaveBeenCalledWith(
        mockUser.id,
        updateProfileDto,
      );
    });
  });

  describe('getUserByName', () => {
    it('should return user by username', async () => {
      const username = 'testuser';
      const foundUser = UserFactory.build({ username });

      service.findByUsername.mockResolvedValue(foundUser);

      const result = await controller.getUserByName(username);

      expect(service.findByUsername).toHaveBeenCalledWith(username);
      expect(result).toBeInstanceOf(UserEntity);
      expect(result.username).toBe(username);
    });

    it('should throw NotFoundException when user not found by username', async () => {
      const username = 'nonexistent';

      service.findByUsername.mockResolvedValue(null);

      await expect(controller.getUserByName(username)).rejects.toThrow(
        NotFoundException,
      );
      await expect(controller.getUserByName(username)).rejects.toThrow(
        'User not found',
      );
    });
  });

  describe('searchUsers', () => {
    it('should search users with query', async () => {
      const query = 'john';
      const mockUsers = [
        new UserEntity(UserFactory.build({ username: 'john1' })),
        new UserEntity(UserFactory.build({ username: 'john2' })),
      ];

      service.searchUsers.mockResolvedValue(mockUsers);

      const result = await controller.searchUsers(query);

      expect(service.searchUsers).toHaveBeenCalledWith(
        query,
        undefined,
        undefined,
      );
      expect(result).toEqual(mockUsers);
    });

    it('should search with community filter', async () => {
      const query = 'user';
      const communityId = 'community-123';

      service.searchUsers.mockResolvedValue([]);

      await controller.searchUsers(query, communityId);

      expect(service.searchUsers).toHaveBeenCalledWith(
        query,
        communityId,
        undefined,
      );
    });

    it('should search with limit parameter', async () => {
      const query = 'test';
      const limit = 10;

      service.searchUsers.mockResolvedValue([]);

      await controller.searchUsers(query, undefined, limit);

      expect(service.searchUsers).toHaveBeenCalledWith(query, undefined, 10);
    });
  });

  describe('getUserById', () => {
    it('should return user by ID', async () => {
      const userId = 'user-123';
      const foundUser = UserFactory.build({ id: userId });

      service.findById.mockResolvedValue(foundUser);

      const result = await controller.getUserById(userId);

      expect(service.findById).toHaveBeenCalledWith(userId);
      expect(result).toBeInstanceOf(UserEntity);
      expect(result.id).toBe(userId);
    });

    it('should throw NotFoundException when user not found by ID', async () => {
      const userId = 'nonexistent-id';

      service.findById.mockResolvedValue(null);

      await expect(controller.getUserById(userId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAllUsers', () => {
    it('should return paginated users with default limit', async () => {
      const mockResponse = {
        users: [
          new UserEntity(UserFactory.build()),
          new UserEntity(UserFactory.build()),
        ],
        continuationToken: 'token-123',
      };

      service.findAll.mockResolvedValue(mockResponse);

      const result = await controller.findAllUsers();

      expect(service.findAll).toHaveBeenCalledWith(undefined, undefined);
      expect(result).toEqual(mockResponse);
    });

    it('should return paginated users with custom limit', async () => {
      const limit = 25;
      const mockResponse = {
        users: [new UserEntity(UserFactory.build())],
        continuationToken: undefined,
      };

      service.findAll.mockResolvedValue(mockResponse);

      const result = await controller.findAllUsers(limit);

      expect(service.findAll).toHaveBeenCalledWith(25, undefined);
      expect(result.users.length).toBe(1);
    });

    it('should support pagination with continuation token', async () => {
      const limit = 50;
      const continuationToken = 'token-abc';

      service.findAll.mockResolvedValue({
        users: [],
        continuationToken: undefined,
      });

      await controller.findAllUsers(limit, continuationToken);

      expect(service.findAll).toHaveBeenCalledWith(50, 'token-abc');
    });
  });

  describe('setUserPassword', () => {
    it('should delegate to the service with the acting user id', async () => {
      const target = new AdminUserEntity(UserFactory.build());
      service.setUserPassword.mockResolvedValue(target);

      const result = await controller.setUserPassword(mockRequest, target.id, {
        password: 'new-password-123',
      });

      expect(service.setUserPassword).toHaveBeenCalledWith(
        target.id,
        'new-password-123',
        mockUser.id,
      );
      expect(result).toBe(target);
    });
  });
});
