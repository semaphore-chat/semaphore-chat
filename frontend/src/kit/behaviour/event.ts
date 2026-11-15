/**
 * The shape of an event, shared by the five behaviour patterns.
 *
 * An event is an object with exactly one key, its name, whose value is the
 * object of fields: `{show: {toast: {...}}}`. The reference reducer rejects
 * anything else; so does this, as a `RangeError` naming the pattern and the
 * event. Not exported from `index.ts`: it is the patterns' own seam.
 */
export function requireEvent<Name extends string>(
  pattern: string,
  event: unknown,
  handled: readonly Name[],
): Name {
  const isRecord = typeof event === 'object' && event !== null && !Array.isArray(event);
  const names = isRecord ? Object.keys(event) : [];
  if (names.length !== 1) {
    throw new RangeError(
      `${pattern}: an event is an object with one key, got ${JSON.stringify(event)}`,
    );
  }
  const [name] = names;
  if (!(handled as readonly string[]).includes(name)) {
    throw new RangeError(
      `${pattern}: unknown event ${JSON.stringify(name)} (expected one of ${handled.join(', ')})`,
    );
  }
  const fields = (event as Record<string, unknown>)[name];
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
    throw new RangeError(
      `${pattern}: event ${JSON.stringify(name)} needs an object of fields, got ${JSON.stringify(fields)}`,
    );
  }
  return name as Name;
}
