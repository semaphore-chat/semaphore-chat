import { readFileSync } from 'fs';
import { resolve } from 'path';
import { normalizeOpenApiDocument } from './normalize-openapi';

const ref = { $ref: '#/components/schemas/Target' };

describe('normalizeOpenApiDocument', () => {
  it.each([
    [[1, 2, 5, 10], 'integer'],
    [[0.5, 1], 'number'],
  ])('types the numeric enum %j as %s', (values, type) => {
    const schema = { type: 'string', enum: values };

    normalizeOpenApiDocument(schema);

    expect(schema).toEqual({ type, enum: values });
  });

  it('leaves other schemas alone', () => {
    const untouched = {
      plainObject: { type: 'object', properties: { a: { type: 'string' } } },
      nullableEnumRef: { nullable: true, allOf: [ref] },
      requiredRef: { allOf: [ref] },
      nullableString: { type: 'string', nullable: true },
      stringEnum: { type: 'string', enum: ['A', 'B'] },
    };
    const before = JSON.parse(JSON.stringify(untouched)) as unknown;

    normalizeOpenApiDocument(untouched);

    expect(untouched).toEqual(before);
  });
});

describe('committed openapi.json', () => {
  const schemas = (
    JSON.parse(
      readFileSync(resolve(__dirname, '../../../openapi.json'), 'utf8'),
    ) as {
      components: {
        schemas: Record<
          string,
          { required?: string[]; properties?: Record<string, any> }
        >;
      };
    }
  ).components.schemas;

  it('has no enum whose values contradict its type', () => {
    const offenders = Object.entries(schemas)
      .filter(
        ([, schema]: [string, any]) =>
          schema.type === 'string' &&
          schema.enum?.some((value: unknown) => typeof value !== 'string'),
      )
      .map(([name]) => name);
    expect(offenders).toEqual([]);
  });

  it.each([
    ['InviteResponseDto', 'createdBy', 'InviteCreatorDto'],
    ['MessageDto', 'replyTo', 'ReplyToPreviewDto'],
    ['MessageDto', 'webhook', 'WebhookInfoDto'],
    ['CommunityBanDto', 'user', 'ModerationUserDto'],
    ['CommunityBanDto', 'moderator', 'ModerationUserDto'],
    ['CommunityTimeoutDto', 'user', 'ModerationUserDto'],
    ['CommunityTimeoutDto', 'moderator', 'ModerationUserDto'],
    ['PinnedMessageDto', 'author', 'PinnedMessageAuthorDto'],
    ['ModerationLogDto', 'moderator', 'ModerationUserDto'],
    ['ModerationLogDto', 'targetUser', 'ModerationUserDto'],
    ['NotificationDto', 'message', 'NotificationMessageDto'],
    ['DmGroupResponseDto', 'lastMessage', 'DmGroupLastMessageDto'],
  ])('%s.%s is a nullable reference to %s', (dto, prop, target) => {
    expect(schemas[dto].properties?.[prop]).toMatchObject({
      nullable: true,
      allOf: [{ $ref: `#/components/schemas/${target}` }],
    });
  });

  it('ModerationLogDto exposes the message an entry is about (#703)', () => {
    expect(schemas.ModerationLogDto.properties?.targetMessageId).toMatchObject({
      type: 'string',
      nullable: true,
    });
    expect(schemas.ModerationLogDto.required ?? []).not.toContain(
      'targetMessageId',
    );
  });

  it('InstanceSettingsResponseDto never lists the VAPID private key (#714)', () => {
    expect(schemas.InstanceSettingsResponseDto.properties).not.toHaveProperty(
      'vapidPrivateKey',
    );
    expect(schemas.InstanceSettingsResponseDto.required ?? []).not.toContain(
      'vapidPrivateKey',
    );
  });

  const clientFields = [
    'attachments',
    'channelId',
    'directMessageGroupId',
    'pendingAttachments',
    'replyToId',
    'spans',
  ];

  it('CreateMessageDto offers only what a client may set', () => {
    expect(
      Object.keys(schemas.CreateMessageDto.properties ?? {}).sort(),
    ).toEqual([
      ...clientFields.slice(0, 2),
      'clientNonce',
      ...clientFields.slice(2),
    ]);
  });

  it('UpdateMessageDto offers only what a client may set', () => {
    expect(
      Object.keys(schemas.UpdateMessageDto.properties ?? {}).sort(),
    ).toEqual(clientFields);
  });

  it('CreateMessageDto requires only what the server validates as required', () => {
    expect([...(schemas.CreateMessageDto.required ?? [])].sort()).toEqual([
      'attachments',
      'spans',
    ]);
  });
});
