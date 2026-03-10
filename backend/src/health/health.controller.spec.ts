import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { HttpStatus } from '@nestjs/common';

function createMockResponse() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as unknown as import('express').Response;
}

describe('HealthController', () => {
  let controller: HealthController;
  let healthService: Mocked<HealthService>;

  beforeEach(async () => {
    const { unit, unitRef } =
      await TestBed.solitary(HealthController).compile();
    controller = unit;
    healthService = unitRef.get(HealthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('check', () => {
    it('should return 200 when all checks pass', async () => {
      const mockHealth = {
        status: 'ok' as const,
        instanceName: 'Test Instance',
        version: '0.0.1',
        timestamp: new Date().toISOString(),
        checks: {
          redis: { status: 'up' as const },
          database: { status: 'up' as const },
        },
      };
      healthService.checkHealth.mockResolvedValue(mockHealth);
      const res = createMockResponse();

      await controller.check(res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(res.json).toHaveBeenCalledWith(mockHealth);
    });

    it('should return 503 when status is degraded', async () => {
      const mockHealth = {
        status: 'degraded' as const,
        instanceName: 'Test Instance',
        version: '0.0.1',
        timestamp: new Date().toISOString(),
        checks: {
          redis: { status: 'down' as const, error: 'Connection refused' },
          database: { status: 'up' as const },
        },
      };
      healthService.checkHealth.mockResolvedValue(mockHealth);
      const res = createMockResponse();

      await controller.check(res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      expect(res.json).toHaveBeenCalledWith(mockHealth);
    });

    it('should return 503 when database is down', async () => {
      const mockHealth = {
        status: 'degraded' as const,
        instanceName: 'Test Instance',
        version: '0.0.1',
        timestamp: new Date().toISOString(),
        checks: {
          redis: { status: 'up' as const },
          database: { status: 'down' as const, error: 'DB offline' },
        },
      };
      healthService.checkHealth.mockResolvedValue(mockHealth);
      const res = createMockResponse();

      await controller.check(res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      expect(res.json).toHaveBeenCalledWith(mockHealth);
    });
  });
});
