import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';

// Param types of HTTP route params. WebSocket (and RPC) handlers pass their
// own numeric param types instead (WsParamtype.PAYLOAD, ...).
const HTTP_PARAM_TYPES: ReadonlySet<unknown> = new Set([
  'body',
  'query',
  'param',
  'custom',
]);

/**
 * The global ValidationPipe, limited to HTTP route params.
 *
 * Since Nest 12, global pipes also run for WebSocket gateway handlers.
 * Gateways validate their payloads with `wsValidationPipe`, which reports
 * failures as a WsException; letting this pipe run first would validate
 * every message twice and turn invalid payloads into a BadRequestException,
 * which the WebSocket exception filter reports as "Internal server error".
 * Values of any other param type pass through untouched, as on Nest 11.
 */
export class HttpValidationPipe extends ValidationPipe {
  protected toValidate(metadata: ArgumentMetadata): boolean {
    return HTTP_PARAM_TYPES.has(metadata.type) && super.toValidate(metadata);
  }
}
