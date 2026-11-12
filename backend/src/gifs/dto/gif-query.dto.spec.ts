import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { DEFAULT_GIF_LIMIT, GifQueryDto, MAX_GIF_LIMIT } from './gif-query.dto';

describe('GifQueryDto', () => {
  async function invalidLimit(value: unknown): Promise<boolean> {
    const dto = plainToInstance(GifQueryDto, { limit: value });
    const errors = await validate(dto);
    return errors.some((e) => e.property === 'limit');
  }

  it('defaults to 20 when limit is omitted', async () => {
    const dto = plainToInstance(GifQueryDto, {});

    expect(dto.limit).toBe(DEFAULT_GIF_LIMIT);
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('accepts the boundaries 1 and 50', async () => {
    await expect(invalidLimit(1)).resolves.toBe(false);
    await expect(invalidLimit(MAX_GIF_LIMIT)).resolves.toBe(false);
  });

  it('rejects 0, negative values and values above 50', async () => {
    await expect(invalidLimit(0)).resolves.toBe(true);
    await expect(invalidLimit(-5)).resolves.toBe(true);
    await expect(invalidLimit(MAX_GIF_LIMIT + 1)).resolves.toBe(true);
  });

  it('rejects a non-integer limit', async () => {
    await expect(invalidLimit('1.5')).resolves.toBe(true);
    await expect(invalidLimit('abc')).resolves.toBe(true);
  });
});
