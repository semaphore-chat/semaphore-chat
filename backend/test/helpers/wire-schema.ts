import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Validates real responses and socket payloads against the committed spec, more
 * strictly than the spec says. The published schemas stay open so clients can
 * tolerate new fields; here every object is closed, so a field the spec doesn't
 * declare (a leaked column, a sensitive user field) fails the test.
 */
function read<T>(file: string): T {
  return JSON.parse(
    readFileSync(resolve(__dirname, '../..', file), 'utf8'),
  ) as T;
}

/**
 * OpenAPI 3.0 to what ajv validates: `nullable` next to a reference has to become
 * an explicit union (a `nullable` sibling can't widen what `allOf` requires).
 */
function toStrictSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toStrictSchema);
  if (!node || typeof node !== 'object') return node;

  const { nullable, ...rest } = node as Record<string, unknown>;
  const schema: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    schema[key] = key === 'enum' ? value : toStrictSchema(value);
  }
  if (schema.properties && schema.additionalProperties === undefined) {
    schema.additionalProperties = false;
  }
  if (!nullable) return schema;
  if (schema.allOf) {
    // @nestjs/swagger adds `type: 'object'` beside the reference: it can't apply
    // to the null branch.
    const { allOf, ...others } = schema;
    delete others.type;
    return {
      ...others,
      anyOf: [{ type: 'null' }, ...(allOf as unknown[])],
    };
  }
  return { anyOf: [{ type: 'null' }, schema] };
}

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const spec = read<{ components: { schemas: unknown } }>('openapi.json');
ajv.addSchema(
  {
    components: { schemas: toStrictSchema(spec.components.schemas) },
  },
  'openapi',
);

const socketEvents = read<{
  server: Record<string, { payload: { $ref: string } }>;
  client: Record<string, { payload: { $ref: string } }>;
}>('socket-events.json');

const validators = new Map<string, ValidateFunction>();

function validator(component: string): ValidateFunction {
  let validate = validators.get(component);
  if (!validate) {
    validate = ajv.compile({
      $ref: `openapi#/components/schemas/${component}`,
    });
    validators.set(component, validate);
  }
  return validate;
}

/** Everything wrong with `value` as this component; empty when it conforms. */
export function schemaErrors(component: string, value: unknown): string[] {
  const validate = validator(component);
  if (validate(value)) return [];
  return (validate.errors ?? []).map(
    (error) =>
      `${error.instancePath || '/'} ${error.message ?? ''} ${JSON.stringify(error.params)}`,
  );
}

/** The component a server event's payload follows, from socket-events.json. */
export function serverEventComponent(event: string): string {
  const entry = socketEvents.server[event];
  if (!entry)
    throw new Error(`socket-events.json has no server event ${event}`);
  return entry.payload.$ref.split('/').pop() as string;
}

export function declaredServerEvents(): string[] {
  return Object.keys(socketEvents.server);
}
