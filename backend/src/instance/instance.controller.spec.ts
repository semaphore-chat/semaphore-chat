import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { InstanceController } from './instance.controller';
import { InstanceService } from './instance.service';
import { RegistrationMode } from '@prisma/client';

describe('InstanceController', () => {
  let controller: InstanceController;
  let service: Mocked<InstanceService>;

  beforeEach(async () => {
    const { unit, unitRef } =
      await TestBed.solitary(InstanceController).compile();

    controller = unit;
    service = unitRef.get(InstanceService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getPublicSettings', () => {
    it('should return registrationMode and maxFileSizeBytes', async () => {
      const mockSettings = {
        id: 'settings-1',
        name: 'Test Instance',
        description: 'A test instance',
        registrationMode: RegistrationMode.OPEN,
        maxFileSizeBytes: BigInt(524288000), // 500MB
        defaultStorageQuotaBytes: BigInt(53687091200),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      service.getSettings.mockResolvedValue(mockSettings as any);

      const result = await controller.getPublicSettings();

      expect(result).toEqual({
        name: 'Test Instance',
        registrationMode: RegistrationMode.OPEN,
        maxFileSizeBytes: 524288000,
      });
    });

    it('should convert BigInt maxFileSizeBytes to Number', async () => {
      const mockSettings = {
        id: 'settings-1',
        name: 'Test Instance',
        description: null,
        registrationMode: RegistrationMode.INVITE_ONLY,
        maxFileSizeBytes: BigInt(1073741824), // 1GB
        defaultStorageQuotaBytes: BigInt(53687091200),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      service.getSettings.mockResolvedValue(mockSettings as any);

      const result = await controller.getPublicSettings();

      expect(typeof result.maxFileSizeBytes).toBe('number');
      expect(result.maxFileSizeBytes).toBe(1073741824);
    });
  });
});
