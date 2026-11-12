import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { SetupInstanceDto } from './setup-instance.dto';

describe('SetupInstanceDto', () => {
  function createDto(partial: Partial<SetupInstanceDto>): SetupInstanceDto {
    return plainToInstance(SetupInstanceDto, {
      adminUsername: 'admin',
      adminPassword: 'password123',
      instanceName: 'My Instance',
      setupToken: 'setup-token',
      ...partial,
    });
  }

  async function errorMessages(
    partial: Partial<SetupInstanceDto>,
  ): Promise<string[]> {
    const errors = await validate(createDto(partial));
    return errors.flatMap((e) => Object.values(e.constraints ?? {}));
  }

  describe('adminUsername', () => {
    it('accepts a two-character username, like registration', async () => {
      await expect(errorMessages({ adminUsername: 'ab' })).resolves.toEqual([]);
    });

    it('rejects a one-character username, like registration', async () => {
      await expect(errorMessages({ adminUsername: 'a' })).resolves.toContain(
        'Username must be at least 2 characters',
      );
    });

    it('rejects a username longer than 32 characters', async () => {
      await expect(
        errorMessages({ adminUsername: 'a'.repeat(33) }),
      ).resolves.toContain('Username must be at most 32 characters');
    });

    it('rejects characters registration would refuse', async () => {
      await expect(
        errorMessages({ adminUsername: 'admin user' }),
      ).resolves.toContain(
        'Username can only contain letters, numbers, underscores, and hyphens',
      );
    });
  });

  describe('adminPassword', () => {
    it('accepts a 128-character password', async () => {
      await expect(
        errorMessages({ adminPassword: 'a'.repeat(128) }),
      ).resolves.toEqual([]);
    });

    it('rejects a 129-character password, like registration', async () => {
      await expect(
        errorMessages({ adminPassword: 'a'.repeat(129) }),
      ).resolves.toContain('Password must be at most 128 characters');
    });

    it('rejects a password shorter than 8 characters', async () => {
      await expect(
        errorMessages({ adminPassword: 'short12' }),
      ).resolves.toContain('Password must be at least 8 characters');
    });
  });
});
