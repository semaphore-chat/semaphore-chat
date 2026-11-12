import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateInstanceSettingsDto } from './update-instance-settings.dto';
import {
  MAX_FILE_SIZE_BYTES,
  MIN_FILE_SIZE_BYTES,
  MIN_STORAGE_QUOTA_BYTES,
} from '@/common/constants/storage-limits.constant';

describe('UpdateInstanceSettingsDto', () => {
  async function errorProperties(
    partial: Partial<UpdateInstanceSettingsDto>,
  ): Promise<string[]> {
    const errors = await validate(
      plainToInstance(UpdateInstanceSettingsDto, partial),
    );
    return errors.map((e) => e.property);
  }

  describe('defaultStorageQuotaBytes', () => {
    it('accepts exactly 1 GB', async () => {
      await expect(
        errorProperties({ defaultStorageQuotaBytes: MIN_STORAGE_QUOTA_BYTES }),
      ).resolves.toEqual([]);
    });

    it('rejects 0', async () => {
      await expect(
        errorProperties({ defaultStorageQuotaBytes: 0 }),
      ).resolves.toContain('defaultStorageQuotaBytes');
    });

    it('rejects just under 1 GB', async () => {
      await expect(
        errorProperties({
          defaultStorageQuotaBytes: MIN_STORAGE_QUOTA_BYTES - 1,
        }),
      ).resolves.toContain('defaultStorageQuotaBytes');
    });
  });

  describe('maxFileSizeBytes', () => {
    it('accepts exactly 1 MB', async () => {
      await expect(
        errorProperties({ maxFileSizeBytes: MIN_FILE_SIZE_BYTES }),
      ).resolves.toEqual([]);
    });

    it('rejects just under 1 MB', async () => {
      await expect(
        errorProperties({ maxFileSizeBytes: MIN_FILE_SIZE_BYTES - 1 }),
      ).resolves.toContain('maxFileSizeBytes');
    });

    it('accepts exactly 1 GB', async () => {
      await expect(
        errorProperties({ maxFileSizeBytes: MAX_FILE_SIZE_BYTES }),
      ).resolves.toEqual([]);
    });

    it('rejects just over 1 GB', async () => {
      await expect(
        errorProperties({ maxFileSizeBytes: MAX_FILE_SIZE_BYTES + 1 }),
      ).resolves.toContain('maxFileSizeBytes');
    });
  });
});
