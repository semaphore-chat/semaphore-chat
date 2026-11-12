import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateStorageSettingsDto } from './storage-stats.dto';
import {
  MAX_FILE_SIZE_BYTES,
  MIN_FILE_SIZE_BYTES,
  MIN_STORAGE_QUOTA_BYTES,
} from '@/common/constants/storage-limits.constant';

describe('UpdateStorageSettingsDto', () => {
  async function errorProperties(
    partial: Partial<UpdateStorageSettingsDto>,
  ): Promise<string[]> {
    const errors = await validate(
      plainToInstance(UpdateStorageSettingsDto, partial),
    );
    return errors.map((e) => e.property);
  }

  it('accepts the same quota and file-size bounds as instance settings', async () => {
    await expect(
      errorProperties({
        defaultStorageQuotaBytes: MIN_STORAGE_QUOTA_BYTES,
        maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
      }),
    ).resolves.toEqual([]);
  });

  it('rejects a quota below 1 GB', async () => {
    await expect(
      errorProperties({
        defaultStorageQuotaBytes: MIN_STORAGE_QUOTA_BYTES - 1,
      }),
    ).resolves.toContain('defaultStorageQuotaBytes');
  });

  it('rejects a file size below 1 MB', async () => {
    await expect(
      errorProperties({ maxFileSizeBytes: MIN_FILE_SIZE_BYTES - 1 }),
    ).resolves.toContain('maxFileSizeBytes');
  });

  it('rejects a file size above 1 GB', async () => {
    await expect(
      errorProperties({ maxFileSizeBytes: MAX_FILE_SIZE_BYTES + 1 }),
    ).resolves.toContain('maxFileSizeBytes');
  });
});
