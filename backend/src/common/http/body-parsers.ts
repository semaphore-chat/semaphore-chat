import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * The content type LiveKit sends its webhooks with. It isn't
 * `application/json`, so Nest's default JSON parser leaves such a body
 * unparsed: the webhook DTO then fails validation (400) before
 * LivekitWebhookController runs, and no participant_joined/left or
 * egress_ended event is ever handled.
 */
export const LIVEKIT_WEBHOOK_CONTENT_TYPE = 'application/webhook+json';

/**
 * Body parsers on top of Nest's defaults. Create the app with
 * `rawBody: true`: webhook signatures are checked against the exact bytes
 * received (`req.rawBody`), which a re-serialized body doesn't reproduce
 * (LiveKit's protojson output varies its whitespace).
 */
export function configureBodyParsers(app: NestExpressApplication): void {
  // This replaces Nest's default JSON parser (it skips its own once a JSON
  // parser is registered), so it must cover application/json as well
  app.useBodyParser('json', {
    type: ['application/json', LIVEKIT_WEBHOOK_CONTENT_TYPE],
  });
}
