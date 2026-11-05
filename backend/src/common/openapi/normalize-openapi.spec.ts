import { readFileSync } from 'fs';
import { resolve } from 'path';
import { normalizeOpenApiDocument } from './normalize-openapi';

describe('normalizeOpenApiDocument', () => {
  it.each([
    [[1, 2, 5, 10], 'integer'],
    [[0.5, 1], 'number'],
  ])('types the numeric enum %j as %s', (values, type) => {
    const schema = { type: 'string', enum: values };

    normalizeOpenApiDocument(schema);

    expect(schema).toEqual({ type, enum: values });
  });

  it('leaves string enums alone', () => {
    const schema = { type: 'string', enum: ['A', 'B'] };

    normalizeOpenApiDocument(schema);

    expect(schema).toEqual({ type: 'string', enum: ['A', 'B'] });
  });
});

describe('committed openapi.json', () => {
  const schemas = (
    JSON.parse(
      readFileSync(resolve(__dirname, '../../../openapi.json'), 'utf8'),
    ) as {
      components: {
        schemas: Record<string, unknown>;
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
});
