/**
 * Post-processing for the generated OpenAPI document.
 *
 * A nullable DTO reference comes out of @nestjs/swagger as
 * `{ nullable: true, type: 'object', allOf: [{ $ref }] }`. The `type` sibling
 * says nothing the reference doesn't, so it is dropped and every nullable
 * reference has the one form enum references already have. It is cleanup, not
 * a fix: progenitor 0.15.1 generates the same `Option<T>` either way.
 *
 * A numeric enum with an `enumName` is registered as a component with
 * `type: 'string'` whatever its property says, which makes the schema invalid:
 * progenitor stops with BadValue("string", Number(1)). Its type follows its
 * values here.
 *
 * Mutates and returns `document`; call it on everything `createDocument`
 * returns, so the served and the committed spec agree.
 */
export function normalizeOpenApiDocument<T extends object>(document: T): T {
  visit(document);
  return document;
}

function visit(node: unknown): void {
  if (Array.isArray(node)) {
    node.forEach(visit);
    return;
  }
  if (!node || typeof node !== 'object') return;

  const schema = node as Record<string, unknown>;
  if (
    schema.type === 'object' &&
    Array.isArray(schema.allOf) &&
    !('properties' in schema)
  ) {
    delete schema.type;
  }
  if (
    schema.type === 'string' &&
    Array.isArray(schema.enum) &&
    schema.enum.length > 0 &&
    schema.enum.every((value) => typeof value === 'number')
  ) {
    schema.type = schema.enum.every(Number.isInteger) ? 'integer' : 'number';
  }
  Object.values(schema).forEach(visit);
}
