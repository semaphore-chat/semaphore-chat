import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { ConfigService } from '@nestjs/config';
import { InstanceController } from './instance.controller';
import { InstanceService } from './instance.service';
import { MailerService } from '@/mailer/mailer.service';
import { RegistrationMode } from '@prisma/client';

describe('InstanceController', () => {
  let controller: InstanceController;
  let service: Mocked<InstanceService>;
  let configService: Mocked<ConfigService>;
  let mailerService: Mocked<MailerService>;

  beforeEach(async () => {
    const { unit, unitRef } =
      await TestBed.solitary(InstanceController).compile();

    controller = unit;
    service = unitRef.get(InstanceService);
    configService = unitRef.get(ConfigService);
    configService.get.mockReturnValue(undefined);
    mailerService = unitRef.get(MailerService);

    // MailerService.isEnabled is a getter, which automocking libraries don't
    // stub the way they do regular methods — define it explicitly so tests
    // can control it per-case.
    Object.defineProperty(mailerService, 'isEnabled', {
      value: false,
      configurable: true,
      writable: true,
    });
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
        gifSearchEnabled: false,
        passwordResetEnabled: false,
        desktopBrowserLogin: true,
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

    it('should set gifSearchEnabled to false when GIPHY_API_KEY is not configured', async () => {
      const mockSettings = {
        id: 'settings-1',
        name: 'Test Instance',
        description: null,
        registrationMode: RegistrationMode.INVITE_ONLY,
        maxFileSizeBytes: BigInt(524288000),
        defaultStorageQuotaBytes: BigInt(53687091200),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      service.getSettings.mockResolvedValue(mockSettings as any);
      configService.get.mockReturnValue(undefined);

      const result = await controller.getPublicSettings();

      expect(result.gifSearchEnabled).toBe(false);
    });

    it('should set gifSearchEnabled to true when GIPHY_API_KEY is configured', async () => {
      const mockSettings = {
        id: 'settings-1',
        name: 'Test Instance',
        description: null,
        registrationMode: RegistrationMode.INVITE_ONLY,
        maxFileSizeBytes: BigInt(524288000),
        defaultStorageQuotaBytes: BigInt(53687091200),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      service.getSettings.mockResolvedValue(mockSettings as any);
      configService.get.mockImplementation((key: string) =>
        key === 'GIPHY_API_KEY' ? 'giphy-key-123' : undefined,
      );

      const result = await controller.getPublicSettings();

      expect(result.gifSearchEnabled).toBe(true);
    });

    it('reports passwordResetEnabled as false when the mailer is disabled', async () => {
      const mockSettings = {
        id: 'settings-1',
        name: 'Test Instance',
        description: null,
        registrationMode: RegistrationMode.INVITE_ONLY,
        maxFileSizeBytes: BigInt(524288000),
        defaultStorageQuotaBytes: BigInt(53687091200),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      service.getSettings.mockResolvedValue(mockSettings as any);
      Object.defineProperty(mailerService, 'isEnabled', { value: false });

      const result = await controller.getPublicSettings();

      expect(result.passwordResetEnabled).toBe(false);
    });

    it('reports passwordResetEnabled as true when the mailer is enabled', async () => {
      const mockSettings = {
        id: 'settings-1',
        name: 'Test Instance',
        description: null,
        registrationMode: RegistrationMode.INVITE_ONLY,
        maxFileSizeBytes: BigInt(524288000),
        defaultStorageQuotaBytes: BigInt(53687091200),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      service.getSettings.mockResolvedValue(mockSettings as any);
      Object.defineProperty(mailerService, 'isEnabled', { value: true });

      const result = await controller.getPublicSettings();

      expect(result.passwordResetEnabled).toBe(true);
    });
  });
});
