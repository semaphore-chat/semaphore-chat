import { readFileSync } from 'fs';
import { resolve } from 'path';
import { normalizeOpenApiDocument } from './normalize-openapi';

const ref = { $ref: '#/components/schemas/Target' };

describe('normalizeOpenApiDocument', () => {
  it('drops the type next to a nullable reference and keeps the rest', () => {
    const document = {
      components: {
        schemas: {
          Dto: {
            type: 'object',
            properties: {
              target: {
                nullable: true,
                type: 'object',
                description: 'kept',
                allOf: [ref],
              },
            },
          },
        },
      },
    };

    normalizeOpenApiDocument(document);

    expect(document.components.schemas.Dto).toEqual({
      type: 'object',
      properties: {
        target: { nullable: true, description: 'kept', allOf: [ref] },
      },
    });
  });

  it('finds them in array items and inline response schemas', () => {
    const inline = { type: 'object', nullable: true, allOf: [ref] };
    const document = {
      paths: {
        '/x': {
          get: {
            responses: {
              200: {
                content: {
                  'application/json': {
                    schema: { type: 'array', items: inline },
                  },
                },
              },
            },
          },
        },
      },
    };

    normalizeOpenApiDocument(document);

    expect(inline).toEqual({ nullable: true, allOf: [ref] });
  });

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
      composedWithOwnProperties: {
        type: 'object',
        allOf: [ref],
        properties: { a: { type: 'string' } },
      },
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

  it('has no reference with a type sibling anywhere', () => {
    const offenders = Object.entries(schemas).flatMap(([name, schema]) =>
      Object.entries(schema.properties ?? {})
        .filter(([, p]) => p.allOf && p.type)
        .map(([prop]) => `${name}.${prop}`),
    );
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
    expect(schemas[dto].properties?.[prop]).toEqual({
      nullable: true,
      allOf: [{ $ref: `#/components/schemas/${target}` }],
    });
  });

  it.each(['CreateMessageDto', 'UpdateMessageDto'])(
    '%s offers only what a client may set',
    (dto) => {
      expect(Object.keys(schemas[dto].properties ?? {}).sort()).toEqual([
        'attachments',
        'channelId',
        'directMessageGroupId',
        'pendingAttachments',
        'replyToId',
        'spans',
      ]);
    },
  );

  it('CreateMessageDto requires only what the server validates as required', () => {
    expect([...(schemas.CreateMessageDto.required ?? [])].sort()).toEqual([
      'attachments',
      'spans',
    ]);
  });
});
