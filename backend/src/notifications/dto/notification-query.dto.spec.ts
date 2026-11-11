import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { NotificationQueryDto } from './notification-query.dto';

describe('NotificationQueryDto', () => {
  it('should reject limit greater than 100', async () => {
    const dto = plainToInstance(NotificationQueryDto, { limit: 200 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'limit')).toBe(true);
  });

  it('should accept limit of 100', async () => {
    const dto = plainToInstance(NotificationQueryDto, { limit: 100 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'limit')).toBe(false);
  });

  it('should accept limit of 1 (minimum)', async () => {
    const dto = plainToInstance(NotificationQueryDto, { limit: 1 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'limit')).toBe(false);
  });

  it('should reject limit of 0 (below minimum)', async () => {
    const dto = plainToInstance(NotificationQueryDto, { limit: 0 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'limit')).toBe(true);
  });

  it('should accept default values when no fields provided', async () => {
    const dto = plainToInstance(NotificationQueryDto, {});
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should reject negative offset', async () => {
    const dto = plainToInstance(NotificationQueryDto, { offset: -1 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'offset')).toBe(true);
  });

  it('should accept offset of 0', async () => {
    const dto = plainToInstance(NotificationQueryDto, { offset: 0 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'offset')).toBe(false);
  });

  describe('unreadOnly', () => {
    it('parses "false" as false, not as true', async () => {
      const dto = plainToInstance(NotificationQueryDto, {
        unreadOnly: 'false',
      });

      expect(dto.unreadOnly).toBe(false);
      expect(await validate(dto)).toHaveLength(0);
    });

    it('parses "true" as true', async () => {
      const dto = plainToInstance(NotificationQueryDto, { unreadOnly: 'true' });

      expect(dto.unreadOnly).toBe(true);
      expect(await validate(dto)).toHaveLength(0);
    });

    it('defaults to false when absent', async () => {
      const dto = plainToInstance(NotificationQueryDto, {});

      expect(dto.unreadOnly).toBe(false);
      expect(await validate(dto)).toHaveLength(0);
    });

    it('rejects a value that is not true or false', async () => {
      const dto = plainToInstance(NotificationQueryDto, {
        unreadOnly: 'yes',
      });

      await expect(validate(dto)).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ property: 'unreadOnly' }),
        ]),
      );
    });
  });
});
