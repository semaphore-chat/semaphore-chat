/**
 * The open thread lives in the chat's URL as `?thread=<parent message id>`, beside `?highlight=` (a jump in the
 * channel), on the channel's own path: Back closes the thread, a reload or a link opens it again, and both shells
 * read it. Pure.
 */

export const THREAD_PARAM = 'thread';

/** An id as the app makes them (uuid-like: letters, digits, dashes); anything else in the URL is ignored. */
const ID = /^[A-Za-z0-9-]{1,64}$/;

/** The thread the URL opens, or null. */
export function readThreadParam(params: URLSearchParams): string | null {
  const id = params.get(THREAD_PARAM);
  return id !== null && ID.test(id) ? id : null;
}

/** `?…` for these params with `name` set to `value` (or removed, for null); '' when none are left. */
export function searchWith(params: URLSearchParams, name: string, value: string | null): string {
  const next = new URLSearchParams(params);
  if (value === null) next.delete(name);
  else next.set(name, value);
  const search = next.toString();
  return search === '' ? '' : `?${search}`;
}
