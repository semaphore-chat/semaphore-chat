import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateMessageDto } from './create-message.dto';

describe('CreateMessageDto', () => {
  const validSpan = { type: 'TEXT', text: 'hello' };
  const validUUID = '123e4567-e89b-12d3-a456-426614174000';

  function createDto(partial: Partial<CreateMessageDto>): CreateMessageDto {
    return plainToInstance(CreateMessageDto, partial);
  }

  it('should accept a valid channelId UUID', async () => {
    const dto = createDto({
      channelId: validUUID,
      spans: [validSpan] as any,
      attachments: [],
    });

    const errors = await validate(dto);
    const channelErrors = errors.filter((e) => e.property === 'channelId');
    expect(channelErrors).toHaveLength(0);
  });

  it('should reject a non-UUID channelId', async () => {
    const dto = createDto({
      channelId: 'not-a-uuid',
      spans: [validSpan] as any,
      attachments: [],
    });

    const errors = await validate(dto);
    const channelErrors = errors.filter((e) => e.property === 'channelId');
    expect(channelErrors.length).toBeGreaterThan(0);
  });

  it('should accept a valid directMessageGroupId UUID', async () => {
    const dto = createDto({
      directMessageGroupId: validUUID,
      spans: [validSpan] as any,
      attachments: [],
    });

    const errors = await validate(dto);
    const dmErrors = errors.filter(
      (e) => e.property === 'directMessageGroupId',
    );
    expect(dmErrors).toHaveLength(0);
  });

  it('should reject a non-UUID directMessageGroupId', async () => {
    const dto = createDto({
      directMessageGroupId: 'not-a-uuid',
      spans: [validSpan] as any,
      attachments: [],
    });

    const errors = await validate(dto);
    const dmErrors = errors.filter(
      (e) => e.property === 'directMessageGroupId',
    );
    expect(dmErrors.length).toBeGreaterThan(0);
  });

  it('should accept null channelId', async () => {
    const dto = createDto({
      channelId: null,
      directMessageGroupId: validUUID,
      spans: [validSpan] as any,
      attachments: [],
    });

    const errors = await validate(dto);
    const channelErrors = errors.filter((e) => e.property === 'channelId');
    expect(channelErrors).toHaveLength(0);
  });

  it('should accept null directMessageGroupId', async () => {
    const dto = createDto({
      channelId: validUUID,
      directMessageGroupId: null,
      spans: [validSpan] as any,
      attachments: [],
    });

    const errors = await validate(dto);
    const dmErrors = errors.filter(
      (e) => e.property === 'directMessageGroupId',
    );
    expect(dmErrors).toHaveLength(0);
  });

  it('should require spans to have at least one element', async () => {
    const dto = createDto({
      channelId: validUUID,
      spans: [],
      attachments: [],
    });

    const errors = await validate(dto);
    const spanErrors = errors.filter((e) => e.property === 'spans');
    expect(spanErrors.length).toBeGreaterThan(0);
  });

  it('should accept spans carrying rich-text formatting flags', async () => {
    const dto = createDto({
      channelId: validUUID,
      spans: [
        {
          type: 'PLAINTEXT',
          text: 'hi',
          bold: true,
          italic: true,
          strikethrough: false,
          code: false,
        },
      ] as any,
      attachments: [],
    });

    const errors = await validate(dto);
    const spanErrors = errors.filter((e) => e.property === 'spans');
    expect(spanErrors).toHaveLength(0);
  });

  it('should preserve rich-text formatting flags on the parsed span', () => {
    const dto = createDto({
      channelId: validUUID,
      spans: [{ type: 'PLAINTEXT', text: 'hi', bold: true, code: true }] as any,
      attachments: [],
    });

    expect(dto.spans[0]).toEqual(
      expect.objectContaining({ bold: true, code: true }),
    );
  });

  it('should accept a CODE_BLOCK span', async () => {
    const dto = createDto({
      channelId: validUUID,
      spans: [{ type: 'CODE_BLOCK', text: 'const x = 1;' }] as any,
      attachments: [],
    });

    const errors = await validate(dto);
    const spanErrors = errors.filter((e) => e.property === 'spans');
    expect(spanErrors).toHaveLength(0);
  });
});
