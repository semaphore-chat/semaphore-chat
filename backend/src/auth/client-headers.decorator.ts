import { applyDecorators } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { CLIENT_TYPES, DEVICE_NAME_MAX_LENGTH } from './client-type.util';

/** The client-type contract's request headers, for the OpenAPI spec. */
export function ApiClientHeaders() {
  return applyDecorators(
    ApiHeader({
      name: 'X-Client-Type',
      required: false,
      enum: CLIENT_TYPES,
      description:
        'What kind of client this is. Absent or unknown means web. Asks for the refresh token in the response body instead of a cookie; it is not proof, and a request that looks like a web page gets cookies whatever it says. Native clients must also send X-Device-Id and a User-Agent, and get no cookies.',
    }),
    ApiHeader({
      name: 'X-Device-Id',
      required: false,
      schema: { type: 'string', format: 'uuid' },
      description:
        "The client install's random id, generated once and kept. A new sign-in replaces the sessions of the same install.",
    }),
    ApiHeader({
      name: 'X-Device-Name',
      required: false,
      schema: { type: 'string', maxLength: DEVICE_NAME_MAX_LENGTH },
      description:
        "Native clients: a name for the device in its owner's sessions list, as percent-encoded UTF-8. Sanitized and capped by the server.",
    }),
  );
}
