import { BadRequestException } from '@nestjs/common';
import { IsString } from 'class-validator';
import { HttpValidationPipe } from './http-validation.pipe';

class TestDto {
  @IsString()
  name: string;
}

describe('HttpValidationPipe', () => {
  const pipe = new HttpValidationPipe({ transform: true, whitelist: true });

  it.each(['body', 'query', 'param'] as const)(
    'validates HTTP %s params',
    async (type) => {
      await expect(
        pipe.transform({ name: 42 }, { type, metatype: TestDto, data: '' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('transforms and whitelists valid HTTP bodies', async () => {
    const result: unknown = await pipe.transform(
      { name: 'ok', extra: true },
      { type: 'body', metatype: TestDto, data: '' },
    );

    expect(result).toBeInstanceOf(TestDto);
    expect(result).toEqual({ name: 'ok' });
  });

  it('leaves WebSocket payloads to the gateway pipe (Nest 12 runs global pipes there too)', async () => {
    const payload = { name: 42, extra: true };

    const result: unknown = await pipe.transform(payload, {
      // WsContextCreator passes WsParamtype.PAYLOAD (3) for @MessageBody()
      type: 3 as unknown as 'body',
      metatype: TestDto,
      data: undefined,
    });

    expect(result).toBe(payload);
  });
});
