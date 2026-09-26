import { IoAdapter } from '@nestjs/platform-socket.io';
import { RedisIoAdapter } from './redis-io.adapter';
import { ConfigService } from '@nestjs/config';
import { INestApplicationContext } from '@nestjs/common';

// Mock redis module
const mockRedisClient = {
  duplicate: jest.fn(),
  on: jest.fn(),
  connect: jest.fn().mockResolvedValue(undefined),
};

jest.mock('redis', () => ({
  createClient: jest.fn(() => mockRedisClient),
}));

// Mock socket.io/redis-adapter
const mockAdapterConstructor = jest.fn();
jest.mock('@socket.io/redis-adapter', () => ({
  createAdapter: jest.fn(() => mockAdapterConstructor),
}));

import { createClient } from 'redis';
import { createAdapter } from '@socket.io/redis-adapter';

describe('RedisIoAdapter', () => {
  let adapter: RedisIoAdapter;
  let mockApp: INestApplicationContext;
  let mockConfigService: ConfigService;

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn((key: string) => {
        const config: Record<string, string> = {
          REDIS_HOST: 'localhost',
          REDIS_PORT: '6379',
        };
        return config[key];
      }),
    } as any;

    mockApp = {
      get: jest.fn((service) => {
        if (service === ConfigService) {
          return mockConfigService;
        }
        return null;
      }),
    } as any;

    // Reset mocks
    jest.clearAllMocks();
    mockRedisClient.duplicate.mockReturnValue({
      ...mockRedisClient,
      on: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
    });

    adapter = new RedisIoAdapter(mockApp);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(adapter).toBeDefined();
  });

  it('should get config service from app', () => {
    expect(mockApp.get).toHaveBeenCalledWith(ConfigService);
  });

  describe('connectToRedis', () => {
    it('should connect to Redis with default config', async () => {
      await adapter.connectToRedis();

      expect(createClient).toHaveBeenCalledWith({
        url: 'redis://localhost:6379',
        commandOptions: { timeout: undefined },
      });
      expect(mockRedisClient.duplicate).toHaveBeenCalled();
      expect(createAdapter).toHaveBeenCalled();
    });

    it('should connect to Redis with custom host and port', async () => {
      const customConfig = {
        get: jest.fn((key: string) => {
          const config: Record<string, string> = {
            REDIS_HOST: 'custom-redis-host',
            REDIS_PORT: '6380',
          };
          return config[key];
        }),
      } as any;

      mockApp.get = jest.fn(() => customConfig);
      adapter = new RedisIoAdapter(mockApp);

      await adapter.connectToRedis();

      expect(createClient).toHaveBeenCalledWith({
        url: 'redis://custom-redis-host:6380',
        commandOptions: { timeout: undefined },
      });
    });

    it('should connect to Redis with password', async () => {
      const configWithPassword = {
        get: jest.fn((key: string) => {
          const config: Record<string, string> = {
            REDIS_HOST: 'secure-host',
            REDIS_PORT: '6379',
            REDIS_PASSWORD: 'secret-password',
          };
          return config[key];
        }),
      } as any;

      mockApp.get = jest.fn(() => configWithPassword);
      adapter = new RedisIoAdapter(mockApp);

      await adapter.connectToRedis();

      expect(createClient).toHaveBeenCalledWith({
        url: 'redis://:secret-password@secure-host:6379',
        commandOptions: { timeout: undefined },
      });
    });

    it('should encode special characters in Redis password', async () => {
      const specialPassword = 'p@ss:w#rd!';
      const configWithSpecialPassword = {
        get: jest.fn((key: string) => {
          const config: Record<string, string> = {
            REDIS_HOST: 'secure-host',
            REDIS_PORT: '6379',
            REDIS_PASSWORD: specialPassword,
          };
          return config[key];
        }),
      } as any;

      mockApp.get = jest.fn(() => configWithSpecialPassword);
      adapter = new RedisIoAdapter(mockApp);

      await adapter.connectToRedis();

      expect(createClient).toHaveBeenCalledWith({
        url: `redis://:${encodeURIComponent(specialPassword)}@secure-host:6379`,
        commandOptions: { timeout: undefined },
      });
    });

    it('should register error handlers for pub client', async () => {
      await adapter.connectToRedis();

      expect(mockRedisClient.on).toHaveBeenCalledWith(
        'error',
        expect.any(Function),
      );
      expect(mockRedisClient.on).toHaveBeenCalledWith(
        'connect',
        expect.any(Function),
      );
    });

    it('should register error handlers for sub client', async () => {
      const mockSubClient = {
        ...mockRedisClient,
        on: jest.fn(),
        connect: jest.fn().mockResolvedValue(undefined),
      };

      mockRedisClient.duplicate.mockReturnValue(mockSubClient);

      await adapter.connectToRedis();

      expect(mockSubClient.on).toHaveBeenCalledWith(
        'error',
        expect.any(Function),
      );
      expect(mockSubClient.on).toHaveBeenCalledWith(
        'connect',
        expect.any(Function),
      );
    });

    it('should connect both pub and sub clients', async () => {
      const mockSubClient = {
        ...mockRedisClient,
        on: jest.fn(),
        connect: jest.fn().mockResolvedValue(undefined),
      };

      mockRedisClient.duplicate.mockReturnValue(mockSubClient);

      await adapter.connectToRedis();

      expect(mockRedisClient.connect).toHaveBeenCalled();
      expect(mockSubClient.connect).toHaveBeenCalled();
    });

    it('should create adapter after connecting', async () => {
      const mockSubClient = {
        ...mockRedisClient,
        on: jest.fn(),
        connect: jest.fn().mockResolvedValue(undefined),
      };

      mockRedisClient.duplicate.mockReturnValue(mockSubClient);

      await adapter.connectToRedis();

      expect(createAdapter).toHaveBeenCalledWith(
        mockRedisClient,
        mockSubClient,
      );
    });

    it('should handle connection errors gracefully', async () => {
      const error = new Error('Redis connection failed');
      mockRedisClient.connect.mockRejectedValueOnce(error);

      await expect(adapter.connectToRedis()).rejects.toThrow(
        'Redis connection failed',
      );
    });

    it('should duplicate pub client to create sub client', async () => {
      await adapter.connectToRedis();

      expect(mockRedisClient.duplicate).toHaveBeenCalledTimes(1);
    });
  });

  describe('createIOServer', () => {
    let mockSuperServer: any;

    beforeEach(async () => {
      // Stub the parent IoAdapter.createIOServer so the real subclass logic
      // runs against a fake Socket.IO server.
      mockSuperServer = {
        adapter: jest.fn(),
      };
      jest
        .spyOn(IoAdapter.prototype, 'createIOServer')
        .mockReturnValue(mockSuperServer);

      // Connect to Redis to set up adapter
      await adapter.connectToRedis();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('keeps the default adapter when connectToRedis() has not run', () => {
      const unconnected = new RedisIoAdapter(mockApp);

      const server = unconnected.createIOServer(3001);

      expect(server).toBe(mockSuperServer);
      expect(mockSuperServer.adapter).not.toHaveBeenCalled();
    });

    it('should create IO server with adapter', () => {
      const port = 3001;
      const options = { cors: { origin: '*' } } as any;

      const server = adapter.createIOServer(port, options);

      expect(server).toBe(mockSuperServer);
      expect(mockSuperServer.adapter).toHaveBeenCalledWith(
        mockAdapterConstructor,
      );
    });

    it('should create IO server on different ports', () => {
      adapter.createIOServer(3001);
      adapter.createIOServer(3002);
      adapter.createIOServer(8080);

      expect(mockSuperServer.adapter).toHaveBeenCalledTimes(3);
    });

    it('should create IO server with various options', () => {
      const options1 = { cors: { origin: '*' } } as any;
      const options2 = { pingTimeout: 60000 } as any;
      const options3 = {} as any;

      adapter.createIOServer(3001, options1);
      adapter.createIOServer(3002, options2);
      adapter.createIOServer(3003, options3);

      expect(mockSuperServer.adapter).toHaveBeenCalledTimes(3);
    });

    it('should use the same adapter constructor for multiple servers', () => {
      adapter.createIOServer(3001);
      adapter.createIOServer(3002);

      const calls = (mockSuperServer.adapter as jest.Mock).mock.calls;
      expect(calls[0][0]).toBe(calls[1][0]);
      expect(calls[0][0]).toBe(mockAdapterConstructor);
    });
  });

  describe('error handling', () => {
    it('should log pub client errors', async () => {
      const errorHandler = jest.fn();
      mockRedisClient.on.mockImplementation((event: string, handler: any) => {
        if (event === 'error') {
          errorHandler.mockImplementation(handler);
        }
      });

      await adapter.connectToRedis();

      // Find the error handler and invoke it
      const errorCall = mockRedisClient.on.mock.calls.find(
        (call) => call[0] === 'error',
      );
      expect(errorCall).toBeDefined();

      // Invoke the error handler
      const testError = new Error('Test pub error');
      if (errorCall && errorCall[1]) {
        errorCall[1](testError);
      }
    });

    it('should log sub client errors', async () => {
      const mockSubClient = {
        ...mockRedisClient,
        on: jest.fn(),
        connect: jest.fn().mockResolvedValue(undefined),
      };

      mockRedisClient.duplicate.mockReturnValue(mockSubClient);

      await adapter.connectToRedis();

      // Find the error handler for sub client
      const errorCall = mockSubClient.on.mock.calls.find(
        (call) => call[0] === 'error',
      );
      expect(errorCall).toBeDefined();

      // Invoke the error handler
      const testError = new Error('Test sub error');
      if (errorCall && errorCall[1]) {
        errorCall[1](testError);
      }
    });

    it('should log pub client connect event', async () => {
      await adapter.connectToRedis();

      const connectCall = mockRedisClient.on.mock.calls.find(
        (call) => call[0] === 'connect',
      );
      expect(connectCall).toBeDefined();

      // Invoke the connect handler
      if (connectCall && connectCall[1]) {
        connectCall[1]();
      }
    });

    it('should log sub client connect event', async () => {
      const mockSubClient = {
        ...mockRedisClient,
        on: jest.fn(),
        connect: jest.fn().mockResolvedValue(undefined),
      };

      mockRedisClient.duplicate.mockReturnValue(mockSubClient);

      await adapter.connectToRedis();

      const connectCall = mockSubClient.on.mock.calls.find(
        (call) => call[0] === 'connect',
      );
      expect(connectCall).toBeDefined();

      // Invoke the connect handler
      if (connectCall && connectCall[1]) {
        connectCall[1]();
      }
    });
  });
});
