/**
 * The header clients send their install's device id in: a random UUID the
 * client generates once and keeps (localStorage), so sign-ins from the same
 * install replace each other's session instead of piling up (#563). Two
 * browser profiles or installs sharing a user agent get different ids.
 */
export const DEVICE_ID_HEADER = 'x-device-id';

/** Any UUID version, in the canonical 36-character form. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The device id a request carries, if it's a well-formed UUID (lower-cased);
 * anything else (missing, repeated header, too long, malformed) is ignored,
 * which only means that sign-in replaces no earlier session.
 */
export function parseDeviceId(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length !== 36) return undefined;
  return UUID_PATTERN.test(value) ? value.toLowerCase() : undefined;
}
