import type { OpenAPIObject } from '@nestjs/swagger';

const HTTP_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
] as const;

/**
 * Every operation can fail, and every failure has the same body, so this goes
 * on all of them at once instead of a decorator on each. An operation that
 * documents its own `default` response keeps it.
 */
export function addErrorResponses(document: OpenAPIObject): OpenAPIObject {
  for (const path of Object.values(document.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = path[method];
      if (operation) {
        operation.responses.default ??= {
          description: 'Error',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponseDto' },
            },
          },
        };
      }
    }
  }
  return document;
}
