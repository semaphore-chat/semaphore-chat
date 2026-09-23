/**
 * Handler-level composition helpers — these produce standalone MSW
 * `RequestHandler`s meant to be *prepended* in front of a scenario's base
 * handlers (MSW matches the first handler in the array, so an override
 * placed before the base handler for the same route wins).
 *
 *   makeHandlers(scenario, {
 *     extraHandlers: [
 *       withErrors('get', '/api/friends', 500),
 *       withSlowEndpoint('get', '/api/notifications', 4000),
 *     ],
 *   })
 */
import { http, HttpResponse, delay, type HttpHandler, type JsonBodyType } from 'msw';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** Make a request to `method path` always fail with `status` (default 500). */
export function withErrors(
  method: Method,
  path: string,
  status = 500,
  body: JsonBodyType = { message: 'Mock error (Ladle sandbox)', statusCode: status },
): HttpHandler {
  return http[method](path, () => HttpResponse.json(body, { status }));
}

/** Make a request to `method path` hang for `ms` before responding with `body` (default: empty 200). */
export function withSlowEndpoint(
  method: Method,
  path: string,
  ms: number,
  body: JsonBodyType = {},
  status = 200,
): HttpHandler {
  return http[method](path, async () => {
    await delay(ms);
    return HttpResponse.json(body, { status });
  });
}

/** Prepend override handlers in front of a scenario's base handlers. */
export function composeHandlers(overrides: HttpHandler[], base: HttpHandler[]): HttpHandler[] {
  return [...overrides, ...base];
}
