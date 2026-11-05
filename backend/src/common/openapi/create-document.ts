import { INestApplication } from '@nestjs/common';
import { OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { SOCKET_EVENT_SCHEMAS } from '@/websocket/socket-event-schemas';
import { ErrorResponseDto } from '@/common/errors/error-response.dto';
import { addErrorResponses } from './error-responses';
import { normalizeOpenApiDocument } from './normalize-openapi';

/** The API document: REST routes plus the socket payload schemas. */
export function createOpenApiDocument(
  app: INestApplication,
  config: Omit<OpenAPIObject, 'paths'>,
): OpenAPIObject {
  return normalizeOpenApiDocument(
    addErrorResponses(
      SwaggerModule.createDocument(app, config, {
        extraModels: [...SOCKET_EVENT_SCHEMAS, ErrorResponseDto],
      }),
    ),
  );
}
