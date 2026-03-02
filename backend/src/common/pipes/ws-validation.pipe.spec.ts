import { IsString, IsArray, IsOptional } from 'class-validator';
import { Exclude } from 'class-transformer';
import { WsException } from '@nestjs/websockets';
import { wsValidationPipe } from './ws-validation.pipe';

class TestDto {
  @IsString()
  channelId: string;

  @IsArray()
  spans: string[];

  @IsOptional()
  @IsString()
  optionalField?: string;

  @Exclude()
  serverOnly: string;
}

describe('wsValidationPipe', () => {
  const metadata = {
    type: 'body' as const,
    metatype: TestDto,
    data: '',
  };

  it('should strip unknown properties not in the DTO', async () => {
    const input = {
      channelId: 'test-channel',
      spans: ['hello'],
      reactions: [],
      unknownField: 'should be removed',
    };

    const result = await wsValidationPipe.transform(input, metadata);

    expect(result.channelId).toBe('test-channel');
    expect(result.spans).toEqual(['hello']);
    expect(result).not.toHaveProperty('reactions');
    expect(result).not.toHaveProperty('unknownField');
  });

  it('should strip @Exclude() fields that lack class-validator decorators', async () => {
    const input = {
      channelId: 'test-channel',
      spans: ['hello'],
      serverOnly: 'should be stripped',
    };

    const result = await wsValidationPipe.transform(input, metadata);

    expect(result.channelId).toBe('test-channel');
    expect(result).not.toHaveProperty('serverOnly');
  });

  it('should keep optional fields when provided', async () => {
    const input = {
      channelId: 'test-channel',
      spans: ['hello'],
      optionalField: 'present',
    };

    const result = await wsValidationPipe.transform(input, metadata);

    expect(result.optionalField).toBe('present');
  });

  it('should throw WsException for invalid input', async () => {
    const input = {
      channelId: 123, // should be string
      spans: 'not-an-array', // should be array
    };

    await expect(wsValidationPipe.transform(input, metadata)).rejects.toThrow(
      WsException,
    );
  });

  it('should not include target or value in validation errors', async () => {
    const input = {
      channelId: 123,
      spans: ['valid'],
    };

    try {
      await wsValidationPipe.transform(input, metadata);
      fail('Expected WsException');
    } catch (error) {
      expect(error).toBeInstanceOf(WsException);
      const wsError = error as WsException;
      const errors = wsError.getError() as Array<Record<string, unknown>>;
      for (const err of errors) {
        expect(err).not.toHaveProperty('target');
        expect(err).not.toHaveProperty('value');
      }
    }
  });

  it('should transform plain objects into DTO class instances', async () => {
    const input = {
      channelId: 'test-channel',
      spans: ['hello'],
    };

    const result = await wsValidationPipe.transform(input, metadata);

    expect(result).toBeInstanceOf(TestDto);
  });
});
