import { defineConfig } from '@hey-api/openapi-ts';

/**
 * The wire types in @semaphore-chat/shared, generated from the same spec so the
 * backend and the frontend can't drift from it. Types only: no client code.
 * Regenerate with: pnpm exec openapi-ts -f openapi-ts.shared.config.ts
 */
export default defineConfig({
  input: process.env.OPENAPI_SPEC_PATH || '../backend/openapi.json',
  output: '../shared/src/generated',
  parser: {
    filters: {
      operations: { include: ['GET /no-operations'] },
      schemas: {
        include: [
          '/PayloadDto$/',
          '/^(MessageDto|MessageReactionsDto|SpanDto|ReactionDto|AttachmentDto|LinkPreviewDto|ReplyToPreviewDto|WebhookInfoDto|SpanType|FileType)$/',
          '/^(CreateMessageDto|CreateMessageSpanDto)$/',
          '/^(ChannelDto|ChannelType|ChannelPreset|NotificationAuthorDto|NotificationMessageDto|NotificationType|VoicePresenceUserDto|DmVoiceCallStarterDto|ReauthenticateResultDto|ReauthenticateError|SessionTerminatedReason)$/',
        ],
      },
    },
  },
  plugins: [{ name: '@hey-api/typescript', enums: 'javascript' }],
});
