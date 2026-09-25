import { client } from './api-client/client.gen';
import { getValidRequestBody } from './api-client/core/utils.gen';
import { getApiBaseUrl } from './config/env';
import {
  getAccessToken,
  refreshSessionWithRetry,
  notifyAuthFailure,
} from './utils/tokenService';

const PUBLIC_ROUTE_PREFIXES = ['/login', '/register', '/join', '/onboarding'];

/** Whether the app is showing a page that works signed out. */
function isOnPublicRoute(): boolean {
  const currentPath = window.location.hash.replace('#', '') || '/';
  return PUBLIC_ROUTE_PREFIXES.some(
    (p) => currentPath === p || currentPath.startsWith(p + '/'),
  );
}

/** What the generated client built the request's body from. */
type RequestBodyOptions = Parameters<typeof getValidRequestBody>[0];

/**
 * Send `request` again with `token`.
 *
 * fetch() has consumed the original request's body by now (`request.clone()`
 * would throw), so the retry sends the body the client built it from again.
 * A form body gets a new multipart boundary, so its old Content-Type goes.
 */
function retryWithToken(
  request: Request,
  token: string,
  opts: RequestBodyOptions,
): Promise<Response> {
  // Copied entry by entry: new Headers(request.headers) trips over a Headers
  // object from another realm (as in jsdom)
  const headers = new Headers();
  request.headers.forEach((value, name) => headers.set(name, value));
  headers.set('Authorization', `Bearer ${token}`);
  const body =
    request.body === null ? null : (getValidRequestBody(opts) as BodyInit | null);
  if (body instanceof FormData) {
    headers.delete('Content-Type');
  }
  return fetch(
    new Request(request.url, {
      method: request.method,
      headers,
      body,
      credentials: request.credentials,
      redirect: request.redirect,
      signal: request.signal,
    }),
  );
}

/**
 * What a request gets back when its token expired and the session couldn't
 * be refreshed for now (network error, 5xx, 429): a retryable error, like
 * the server being briefly unavailable. The generated client throws the JSON
 * body, so TanStack Query sees an ordinary error (and retries it).
 */
function sessionRefreshUnavailableResponse(): Response {
  return new Response(
    JSON.stringify({
      statusCode: 503,
      message: 'Could not refresh the session. Try again.',
      error: 'Service Unavailable',
    }),
    {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

export function configureApiClient() {
  // The generated SDK URLs already include the /api prefix (e.g. /api/auth/login),
  // so baseUrl should be empty for web (Vite proxy handles /api) or the server origin for Electron.
  const baseUrl = getApiBaseUrl();
  // Strip the /api suffix since it's already in the generated paths
  const clientBaseUrl = baseUrl.endsWith('/api') ? baseUrl.slice(0, -4) : baseUrl;
  client.setConfig({ baseUrl: clientBaseUrl });

  client.interceptors.request.use((request) => {
    const token = getAccessToken();
    if (token) {
      request.headers.set('Authorization', `Bearer ${token}`);
    }
    return request;
  });

  client.interceptors.response.use(async (response, request, opts) => {
    if (response.status !== 401) {
      return response;
    }

    // Don't intercept 401s from auth endpoints — those mean "bad credentials",
    // not "expired token". The old RTK Query code used a separate base query
    // without this interceptor for login/register/refresh.
    const url = new URL(request.url, window.location.origin);
    if (url.pathname.startsWith('/api/auth/')) {
      return response;
    }

    // The token was refreshed while this request was in flight: try the
    // current one instead of refreshing again (each refresh rotates the
    // refresh token, and the server is strict about reusing one).
    const currentToken = getAccessToken();
    if (currentToken && request.headers.get('Authorization') !== `Bearer ${currentToken}`) {
      return retryWithToken(request, currentToken, opts);
    }

    // Concurrent 401s share one refresh (and its retries).
    const result = await refreshSessionWithRetry();

    if (result.status === 'refreshed') {
      return retryWithToken(request, result.token, opts);
    }

    if (result.status === 'unavailable') {
      // No answer about the session: keep it, and fail this request with
      // an error that may go away on retry.
      return sessionRefreshUnavailableResponse();
    }

    // The server refused the session — notify the auth layer (AuthGate) to
    // handle cleanup and redirect. Don't perform side effects here
    // (navigation, socket teardown) — that's the UI layer's responsibility.
    if (!isOnPublicRoute()) {
      notifyAuthFailure();
    }
    return response;
  });
}
