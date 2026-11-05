import type { OpenAPIObject } from '@nestjs/swagger';
import { addErrorResponses } from './error-responses';

describe('addErrorResponses', () => {
  const documentWith = (paths: OpenAPIObject['paths']) =>
    ({ openapi: '3.0.0', info: {}, paths }) as OpenAPIObject;

  it('documents the error body on every operation', () => {
    const document = addErrorResponses(
      documentWith({
        '/a': {
          get: { responses: { 200: { description: 'ok' } } },
          post: { responses: { 201: { description: 'ok' } } },
        },
        '/b': { delete: { responses: { 204: { description: 'ok' } } } },
      }),
    );

    const schema = {
      $ref: '#/components/schemas/ErrorResponseDto',
    };
    for (const operation of [
      document.paths['/a'].get,
      document.paths['/a'].post,
      document.paths['/b'].delete,
    ]) {
      expect(operation?.responses.default).toMatchObject({
        content: { 'application/json': { schema } },
      });
    }
    expect(document.paths['/a'].get?.responses[200]).toEqual({
      description: 'ok',
    });
  });

  it('keeps a default response an operation already documents', () => {
    const own = { description: 'mine' };
    const document = addErrorResponses(
      documentWith({ '/a': { get: { responses: { default: own } } } }),
    );

    expect(document.paths['/a'].get?.responses.default).toBe(own);
  });
});
