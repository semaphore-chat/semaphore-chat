import { instanceToPlain } from 'class-transformer';
import { InstanceSettingsResponseDto } from './instance-settings-response.dto';
import { RegistrationMode } from '@prisma/client';

describe('InstanceSettingsResponseDto', () => {
  describe('BigInt serialization', () => {
    it('should transform defaultStorageQuotaBytes BigInt to Number', () => {
      const settings = new InstanceSettingsResponseDto({
        id: 'settings-123',
        name: 'Semaphore Chat',
        description: 'Test instance',
        registrationMode: RegistrationMode.INVITE_ONLY,
        createdAt: new Date(),
        updatedAt: new Date(),
        defaultStorageQuotaBytes: BigInt(53687091200), // 50GB
        maxFileSizeBytes: BigInt(524288000), // 500MB
      });

      const plain = instanceToPlain(settings);

      expect(typeof plain.defaultStorageQuotaBytes).toBe('number');
      expect(plain.defaultStorageQuotaBytes).toBe(53687091200);
      expect(typeof plain.maxFileSizeBytes).toBe('number');
      expect(plain.maxFileSizeBytes).toBe(524288000);
    });

    it('should handle zero BigInt values', () => {
      const settings = new InstanceSettingsResponseDto({
        id: 'settings-123',
        name: 'Semaphore Chat',
        defaultStorageQuotaBytes: BigInt(0),
        maxFileSizeBytes: BigInt(0),
      });

      const plain = instanceToPlain(settings);

      expect(plain.defaultStorageQuotaBytes).toBe(0);
      expect(plain.maxFileSizeBytes).toBe(0);
    });

    it('should handle null/undefined BigInt values gracefully', () => {
      const settings = new InstanceSettingsResponseDto({
        id: 'settings-123',
        name: 'Semaphore Chat',
        defaultStorageQuotaBytes: null as any,
        maxFileSizeBytes: undefined,
      });

      const plain = instanceToPlain(settings);

      expect(plain.defaultStorageQuotaBytes).toBe(0);
      expect(plain.maxFileSizeBytes).toBe(0);
    });

    it('should serialize to valid JSON without BigInt errors', () => {
      const settings = new InstanceSettingsResponseDto({
        id: 'settings-123',
        name: 'Semaphore Chat Instance',
        description: 'A test instance',
        registrationMode: RegistrationMode.OPEN,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
        defaultStorageQuotaBytes: BigInt(107374182400), // 100GB
        maxFileSizeBytes: BigInt(1073741824), // 1GB
      });

      const plain = instanceToPlain(settings);

      // This should not throw "Do not know how to serialize a BigInt"
      expect(() => JSON.stringify(plain)).not.toThrow();

      const json = JSON.stringify(plain);
      const parsed = JSON.parse(json);

      expect(parsed.defaultStorageQuotaBytes).toBe(107374182400);
      expect(parsed.maxFileSizeBytes).toBe(1073741824);
      expect(parsed.name).toBe('Semaphore Chat Instance');
      expect(parsed.registrationMode).toBe('OPEN');
    });

    it('should exclude vapidPrivateKey from serialized output', () => {
      const settings = new InstanceSettingsResponseDto({
        id: 'settings-123',
        name: 'Semaphore Chat',
        defaultStorageQuotaBytes: BigInt(53687091200),
        maxFileSizeBytes: BigInt(524288000),
        vapidPublicKey: 'public-key-123',
        vapidPrivateKey: 'secret-private-key',
        vapidSubject: 'mailto:admin@example.com',
      });

      const plain = instanceToPlain(settings);

      expect(plain.vapidPublicKey).toBe('public-key-123');
      expect(plain.vapidSubject).toBe('mailto:admin@example.com');
      expect(plain).not.toHaveProperty('vapidPrivateKey');
    });

    it('should preserve all other fields correctly', () => {
      const createdAt = new Date('2024-01-01');
      const updatedAt = new Date('2024-01-02');

      const settings = new InstanceSettingsResponseDto({
        id: 'settings-456',
        name: 'My Instance',
        description: 'Description here',
        registrationMode: RegistrationMode.CLOSED,
        createdAt,
        updatedAt,
        defaultStorageQuotaBytes: BigInt(53687091200),
        maxFileSizeBytes: BigInt(524288000),
      });

      const plain = instanceToPlain(settings);

      expect(plain.id).toBe('settings-456');
      expect(plain.name).toBe('My Instance');
      expect(plain.description).toBe('Description here');
      expect(plain.registrationMode).toBe('CLOSED');
    });
  });
});
